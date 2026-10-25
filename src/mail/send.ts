import { editionByDate, latestEdition, sourcesFor, storiesFor, type Edition } from "../editions";
import { readFirst } from "../read-first";
import { dueSlot, editionKey, localTime, LOCAL_SEND_HOUR, takes, type Slot } from "../slots";
import type { Env } from "../env";
import { signLink } from "../links";
import { activeSubscribers, dueSubscribers, markSent, type Subscriber } from "../subscribers";
import { sha256Hex, utcDate } from "../util";
import { BATCH_MAX, MailError, sendBatch, type Email } from "./resend";
import { digestEmail, digestFor, type EmailPhoto } from "./templates";
import { displayImage } from "../build/photos";

export type SendReport = { date: string; status: "sent" | "no-edition" | "partial"; sent: number; due: number; error?: string };

const RETRY_DELAYS_MS = [2_000, 8_000];

/** Sends one batch, retrying transient failures with the same idempotency key. */
async function sendWithRetry(apiKey: string, emails: Email[], key: string, fetcher: typeof fetch, sleep: (ms: number) => Promise<void>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await sendBatch(apiKey, emails, key, fetcher);
    } catch (err) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (!(err instanceof MailError && err.retryable) || delay === undefined) throw err;
      await sleep(delay);
    }
  }
}

export function requireSecrets(env: Env): { apiKey: string; linkSecret: string } {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set.");
  if (!env.LINK_SECRET) throw new Error("LINK_SECRET is not set.");
  return { apiKey: env.RESEND_API_KEY, linkSecret: env.LINK_SECRET };
}

/** One email to send: who, which edition, and the key it marks as sent ("2026-10-25-pm", in their local date). */
type Recipient = { sub: Subscriber; slot: Slot; key: string; morningAt: number };

/**
 * Sends the edition to these recipients in batches. Safe to re-run: each batch carries an idempotency key built
 * from its recipients and edition keys, and readers are marked sent batch by batch.
 */
async function deliver(env: Env, edition: Edition, recipients: readonly Recipient[], fetcher: typeof fetch, now: number, sleep: (ms: number) => Promise<void>): Promise<SendReport> {
  const date = edition.date;
  if (recipients.length === 0) return { date, status: "sent", sent: 0, due: 0 };
  const { apiKey, linkSecret } = requireSecrets(env);
  const stories = await storiesFor(env.DB, date);
  const sources = await sourcesFor(env.DB, stories.filter((s) => s.front));
  const photos = new Map<string, EmailPhoto>();
  for (const s of stories) {
    const src = s.imageItemId ? sources.get(s.imageItemId) : undefined;
    if (src?.imageUrl) photos.set(s.id, { url: displayImage(src.imageUrl), credit: src.outlet.name });
  }
  const firstReads = new Map(stories.filter((s) => s.front).flatMap((s) => {
    const src = readFirst(s, sources);
    return src ? [[s.id, src] as const] : [];
  }));
  let sent = 0;

  for (let i = 0; i < recipients.length; i += BATCH_MAX) {
    const chunk = recipients.slice(i, i + BATCH_MAX);
    const emails: Email[] = await Promise.all(
      chunk.map(async ({ sub, slot, morningAt }) => {
        const manageUrl = `${env.APP_URL}/manage/${await signLink(linkSecret, "manage", sub.id)}`;
        const unsubscribeUrl = `${env.APP_URL}/unsubscribe/${await signLink(linkSecret, "manage", sub.id)}`;
        const mail = digestEmail(edition, digestFor(stories, sub.topics), env.APP_URL, manageUrl, photos, firstReads, slot, morningAt);
        return {
          from: env.MAIL_FROM,
          to: sub.email,
          ...mail,
          // One-click unsubscribe (RFC 8058), which Gmail and Yahoo require for bulk senders.
          headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        };
      }),
    );
    const batchKey = `tare-${await sha256Hex(chunk.map((r) => `${r.sub.id}:${r.key}`).join(","))}`;
    try {
      await sendWithRetry(apiKey, emails, batchKey, fetcher, sleep);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`digest batch failed: ${error}`);
      return { date, status: "partial", sent, due: recipients.length, error };
    }
    for (const key of new Set(chunk.map((r) => r.key))) await markSent(env.DB, chunk.filter((r) => r.key === key).map((r) => r.sub.id), key);
    // Delivery has begun: from here the edition's story links are in inboxes and must not change.
    if (sent === 0) await env.DB.prepare("UPDATE editions SET sent_at = COALESCE(sent_at, ?) WHERE date = ?").bind(now, date).run();
    sent += chunk.length;
  }
  return { date, status: "sent", sent, due: recipients.length };
}

/**
 * Emails one slot's edition to every active subscriber who takes it and hasn't had it, whatever their time zone.
 * For manual runs (POST /admin/run/send); the hourly cron uses sendDue.
 */
export async function sendEdition(
  env: Env,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  slot: Slot = "am",
): Promise<SendReport> {
  const date = utcDate(now);
  const key = editionKey(date, slot);
  const edition = await editionByDate(env.DB, date);
  if (!edition) return { date, status: "no-edition", sent: 0, due: 0 };
  const due = await dueSubscribers(env.DB, key, slot);
  const morningAt = Date.parse(`${date}T11:00:00Z`);
  return deliver(env, edition, due.map((sub) => ({ sub, slot, key, morningAt })), fetcher, now, sleep);
}

/**
 * The hourly send: each reader whose local clock is at 7 a.m. or 6 p.m. (or the hour after, to retry a failed
 * run) gets that edition, once, if they take it. Readers are matched in their own time zone.
 */
export async function sendDue(
  env: Env,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
): Promise<SendReport> {
  const edition = await latestEdition(env.DB);
  if (!edition) return { date: utcDate(now), status: "no-edition", sent: 0, due: 0 };
  const recipients = (await activeSubscribers(env.DB)).flatMap((sub): Recipient[] => {
    const due = dueSlot(now, sub.timezone);
    if (!due || !takes(sub.editions, due.slot) || (sub.lastSentDate ?? "") >= due.key) return [];
    const { hour } = localTime(now, sub.timezone);
    return [{ sub, ...due, morningAt: now - (hour - LOCAL_SEND_HOUR.am) * 3600_000 }];
  });
  return deliver(env, edition, recipients, fetcher, now, sleep);
}
