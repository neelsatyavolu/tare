import { z } from "zod";
import { choiceFor, type EditionChoice, type Slot } from "./slots";
import { isTopicId, type TopicId } from "./topics";

export type Subscriber = { id: string; email: string; topics: TopicId[]; status: "pending" | "active" | "unsubscribed"; lastSentDate: string | null; editions: EditionChoice };

type Row = { id: string; email: string; topics: string; status: Subscriber["status"]; last_sent_date: string | null; confirm_sent_at: number | null; editions: EditionChoice | null };

/** Minimum gap between two emails a sign-up can trigger for the same address. */
export const RESEND_COOLDOWN_MS = 10 * 60_000;

const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export function parseEmail(raw: unknown): string | null {
  const r = EmailSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export function parseTopics(raw: readonly unknown[]): TopicId[] {
  return [...new Set(raw.filter((t): t is string => typeof t === "string").filter(isTopicId))];
}

function toSubscriber(r: Row): Subscriber {
  const topics = (JSON.parse(r.topics) as string[]).filter(isTopicId);
  return { id: r.id, email: r.email, topics, status: r.status, lastSentDate: r.last_sent_date, editions: r.editions ?? "both" };
}

const COLUMNS = "id, email, topics, status, last_sent_date, confirm_sent_at, editions";

/**
 * The account for an address, created (pending) if new. Concurrent requests for the same new address
 * can't both insert: the second hits ON CONFLICT and reads the first one's row.
 */
async function findOrCreate(db: D1Database, email: string, topics: TopicId[], now: number): Promise<Row> {
  await db
    .prepare("INSERT INTO subscribers (id, email, topics, status, created_at) VALUES (?, ?, ?, 'pending', ?) ON CONFLICT(email) DO NOTHING")
    .bind(crypto.randomUUID(), email, JSON.stringify(topics), now)
    .run();
  return (await db.prepare(`SELECT ${COLUMNS} FROM subscribers WHERE email = ?`).bind(email).first<Row>())!;
}

/**
 * Claims the right to email this address now: a compare-and-swap on confirm_sent_at, so two requests
 * racing past the cooldown can't both send. Returns the previous value for `releaseEmailClaim`.
 */
async function claimEmail(db: D1Database, row: Row, now: number): Promise<{ claimed: boolean; previous: number | null }> {
  const previous = row.confirm_sent_at;
  if (previous != null && now - previous < RESEND_COOLDOWN_MS) return { claimed: false, previous };
  const r = await db
    .prepare("UPDATE subscribers SET confirm_sent_at = ? WHERE id = ? AND confirm_sent_at IS ?")
    .bind(now, row.id, previous)
    .run();
  return { claimed: (r.meta.changes ?? 0) === 1, previous };
}

/** Undoes a claim after the email failed to send, so the reader can retry right away. */
export async function releaseEmailClaim(db: D1Database, id: string, previous: number | null, claimedAt: number): Promise<void> {
  await db.prepare("UPDATE subscribers SET confirm_sent_at = ? WHERE id = ? AND confirm_sent_at = ?").bind(previous, id, claimedAt).run();
}

/** What to email after a form post: a confirm link, a manage link (already subscribed), or nothing (cooldown). */
export type EmailOutcome = { id: string; email: string; send: "confirm" | "manage" | "signin" | null; previous: number | null; claimedAt: number };

/**
 * Records a sign-up. The caller always shows the same "check your inbox" page, so the form never reveals
 * whether an address is subscribed. Topics from the form only apply to an unconfirmed sign-up; a confirmed
 * account's topics change from the account page.
 */
export async function signUp(db: D1Database, email: string, topics: TopicId[], now = Date.now()): Promise<EmailOutcome> {
  const row = await findOrCreate(db, email, topics, now);
  const { claimed, previous } = await claimEmail(db, row, now);
  if (!claimed) return { id: row.id, email, send: null, previous, claimedAt: now };
  if (row.status === "pending") {
    await db.prepare("UPDATE subscribers SET topics = ? WHERE id = ? AND status = 'pending'").bind(JSON.stringify(topics), row.id).run();
  }
  return { id: row.id, email, send: row.status === "active" ? "manage" : "confirm", previous, claimedAt: now };
}

/** Finds or creates the account for a sign-in request; `send` is null while the cooldown runs. */
export async function requestSignin(db: D1Database, email: string, now = Date.now()): Promise<EmailOutcome> {
  const row = await findOrCreate(db, email, [], now);
  const { claimed, previous } = await claimEmail(db, row, now);
  return { id: row.id, email, send: claimed ? "signin" : null, previous, claimedAt: now };
}

/**
 * Called when someone signs in with an emailed link, which proves they own the address. A pending account
 * becomes confirmed with the daily email off; signing in never subscribes anyone.
 */
export async function verifyEmail(db: D1Database, id: string, now = Date.now()): Promise<Subscriber | null> {
  await db.prepare("UPDATE subscribers SET status = 'unsubscribed', confirmed_at = ? WHERE id = ? AND status = 'pending'").bind(now, id).run();
  return findById(db, id);
}

/** Turns the daily email on or off for a confirmed account. */
export async function setDigest(db: D1Database, id: string, on: boolean): Promise<void> {
  await db
    .prepare("UPDATE subscribers SET status = ? WHERE id = ? AND status != 'pending'")
    .bind(on ? "active" : "unsubscribed", id)
    .run();
}

/** Removes the account, its sessions and any connected AI account. */
export async function deleteAccount(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE subscriber_id = ?").bind(id),
    db.prepare("DELETE FROM ai_connections WHERE subscriber_id = ?").bind(id),
    db.prepare("DELETE FROM subscribers WHERE id = ?").bind(id),
  ]);
}

export async function findById(db: D1Database, id: string): Promise<Subscriber | null> {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM subscribers WHERE id = ?`).bind(id).first<Row>();
  return row ? toSubscriber(row) : null;
}

/**
 * Turns the daily email on after the reader pressed Confirm on an unexpired confirm link. Only ever runs
 * from a POST, so mail scanners that open links can't subscribe anyone.
 */
export async function confirm(db: D1Database, id: string, now = Date.now()): Promise<Subscriber | null> {
  await db
    .prepare("UPDATE subscribers SET status = 'active', confirmed_at = COALESCE(confirmed_at, ?) WHERE id = ? AND status != 'active'")
    .bind(now, id)
    .run();
  return findById(db, id);
}

export async function setTopics(db: D1Database, id: string, topics: TopicId[]): Promise<void> {
  await db.prepare("UPDATE subscribers SET topics = ? WHERE id = ?").bind(JSON.stringify(topics), id).run();
}

export async function setEditions(db: D1Database, id: string, editions: EditionChoice): Promise<void> {
  await db.prepare("UPDATE subscribers SET editions = ? WHERE id = ?").bind(editions, id).run();
}

export async function unsubscribe(db: D1Database, id: string): Promise<void> {
  await db.prepare("UPDATE subscribers SET status = 'unsubscribed' WHERE id = ?").bind(id).run();
}

/**
 * Active subscribers who take this slot's edition and haven't been sent it. `key` is the edition key
 * ("2026-10-25-pm"); keys sort in send order, so anyone whose last key is earlier is due.
 */
export async function dueSubscribers(db: D1Database, key: string, slot: Slot): Promise<Subscriber[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNS} FROM subscribers WHERE status = 'active' AND (editions = 'both' OR editions = ?)
         AND (last_sent_date IS NULL OR last_sent_date < ?) ORDER BY created_at`,
    )
    .bind(choiceFor(slot), key)
    .all<Row>();
  return results.map(toSubscriber);
}

export async function markSent(db: D1Database, ids: readonly string[], key: string): Promise<void> {
  if (ids.length === 0) return;
  const stmt = db.prepare("UPDATE subscribers SET last_sent_date = ? WHERE id = ?");
  await db.batch(ids.map((id) => stmt.bind(key, id)));
}
