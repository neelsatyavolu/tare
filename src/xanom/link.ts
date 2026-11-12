import { sha256Hex } from "../util";
import type { Intent, XanomIdentity } from "./oidc";

/**
 * The linking rules from the Xanom spec (§2), run at the callback once the id_token checks out:
 *  1. a reader already linked to this Xanom account signs in as themselves;
 *  2. link/convert attaches the account to the signed-in reader (convert also needs the same email);
 *  3. a reader with the same email gets the account attached and is signed in;
 *  4. otherwise a new reader is made.
 * Tare has no passwords and only starts sessions after an emailed code or link, so the pre-hijacking guard in
 * rule 3 only meets 'pending' rows: addresses someone typed into a form but never confirmed. Those get confirmed
 * here (Xanom verified the address) and any stray codes or sessions on them are dropped.
 */
export type XanomError = "taken" | "other-link" | "email-mismatch" | "unverified" | "signed-out" | "failed" | "expired" | "cancelled" | "unavailable";

/** What each failure tells the reader, on the site and in the app. */
export const XANOM_ERRORS: Record<XanomError, string> = {
  taken: "That Xanom account is already linked to a different Tare account. Sign in with it to use that account.",
  "other-link": "This Tare account is already linked to a different Xanom account.",
  "email-mismatch": "That Xanom account uses a different email than your Tare account. To use it anyway, choose “Link an existing Xanom account”.",
  unverified: "Your Xanom account's email isn't verified yet. Verify it at accounts.xanom.co, then try again.",
  "signed-out": "Your Tare session ended. Sign in again, then try once more.",
  failed: "Xanom sign-in didn't go through. Try again.",
  expired: "That sign-in took too long or was started somewhere else. Try again.",
  cancelled: "Xanom sign-in was cancelled.",
  unavailable: "Xanom sign-in isn't available right now. Use your email instead.",
};

export const isXanomError = (v: unknown): v is XanomError => typeof v === "string" && Object.hasOwn(XANOM_ERRORS, v);

export type LinkResult =
  | { ok: true; subscriberId: string; created: boolean }
  | { ok: false; error: XanomError };

type Linked = { id: string; email: string; status: string; xanom_sub: string | null };

const byColumn = (db: D1Database, column: "xanom_sub" | "email" | "id", value: string) =>
  db.prepare(`SELECT id, email, status, xanom_sub FROM subscribers WHERE ${column} = ?`).bind(value).first<Linked>();

/** Attaches the Xanom account. Refuses (false) if the row already has another one, or the sub is taken. */
async function attach(db: D1Database, id: string, who: XanomIdentity): Promise<boolean> {
  try {
    const r = await db
      .prepare("UPDATE subscribers SET xanom_sub = ?, xanom_email = ? WHERE id = ? AND (xanom_sub IS NULL OR xanom_sub = ?)")
      .bind(who.sub, who.email, id, who.sub)
      .run();
    return (r.meta.changes ?? 0) === 1;
  } catch {
    // The unique index: a concurrent callback attached this sub elsewhere first.
    return false;
  }
}

export async function linkXanom(db: D1Database, who: XanomIdentity, intent: Intent, currentId: string | null, now = Date.now()): Promise<LinkResult> {
  // Rule 1.
  const linked = await byColumn(db, "xanom_sub", who.sub);
  if (linked) {
    if (intent !== "signin" && currentId && linked.id !== currentId) return { ok: false, error: "taken" };
    await db.prepare("UPDATE subscribers SET xanom_email = ? WHERE id = ?").bind(who.email, linked.id).run();
    return { ok: true, subscriberId: linked.id, created: false };
  }

  // Rule 2.
  if (intent !== "signin" && currentId) {
    const current = await byColumn(db, "id", currentId);
    if (!current) return { ok: false, error: "signed-out" };
    if (intent === "convert" && current.email !== who.email) return { ok: false, error: "email-mismatch" };
    if (current.xanom_sub) return { ok: false, error: "other-link" };
    return (await attach(db, current.id, who)) ? { ok: true, subscriberId: current.id, created: false } : { ok: false, error: "taken" };
  }

  // Rule 3. Only a verified address may claim an existing account by email.
  if (!who.emailVerified) return { ok: false, error: "unverified" };
  const sameEmail = await byColumn(db, "email", who.email);
  if (sameEmail) {
    if (sameEmail.status === "pending") {
      // Never confirmed by Tare: whoever typed this address in had no way to sign in, but drop anything they left.
      await db.batch([
        db.prepare("DELETE FROM sessions WHERE subscriber_id = ?").bind(sameEmail.id),
        db.prepare("DELETE FROM signin_codes WHERE subscriber_id = ?").bind(sameEmail.id),
        db.prepare("UPDATE subscribers SET status = 'unsubscribed', confirmed_at = ? WHERE id = ? AND status = 'pending'").bind(now, sameEmail.id),
      ]);
    }
    // Linked to some other Xanom account already: the address is proven either way, so sign in without relinking.
    if (!sameEmail.xanom_sub) await attach(db, sameEmail.id, who);
    return { ok: true, subscriberId: sameEmail.id, created: sameEmail.status === "pending" };
  }

  // Rule 4. Confirmed (Xanom verified the address) but not subscribed: signing in never turns on email.
  const id = crypto.randomUUID();
  try {
    await db
      .prepare("INSERT INTO subscribers (id, email, topics, status, created_at, confirmed_at, xanom_sub, xanom_email) VALUES (?, ?, '[]', 'unsubscribed', ?, ?, ?, ?)")
      .bind(id, who.email, now, now, who.sub, who.email)
      .run();
  } catch {
    // A concurrent request created this address or attached the sub; the reader can just try again.
    return { ok: false, error: "failed" };
  }
  return { ok: true, subscriberId: id, created: true };
}

/** The Xanom account a reader is linked to, for the account page and the app. */
export async function xanomLink(db: D1Database, subscriberId: string): Promise<{ email: string } | null> {
  const row = await db.prepare("SELECT xanom_sub, xanom_email FROM subscribers WHERE id = ?").bind(subscriberId).first<{ xanom_sub: string | null; xanom_email: string | null }>();
  return row?.xanom_sub ? { email: row.xanom_email ?? "" } : null;
}

// ── iOS handoffs ────────────────────────────────────────────────────────

export type HandoffKind = "ios_start" | "ios_ticket";
export const HANDOFF_TTL_MS: Record<HandoffKind, number> = { ios_start: 120_000, ios_ticket: 60_000 };

/** Stores a one-time handoff and returns its raw value. Only the hash is kept. */
export async function createHandoff(db: D1Database, kind: HandoffKind, subscriberId: string, extra: { intent?: Intent; created?: boolean; challenge?: string } = {}, now = Date.now()): Promise<string> {
  const raw = crypto.getRandomValues(new Uint8Array(32)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
  await db.batch([
    db.prepare("DELETE FROM xanom_handoffs WHERE expires_at < ?").bind(now),
    db.prepare("INSERT INTO xanom_handoffs (hash, kind, subscriber_id, intent, created, challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(await sha256Hex(raw), kind, subscriberId, extra.intent ?? null, extra.created ? 1 : 0, extra.challenge ?? null, now + HANDOFF_TTL_MS[kind]),
  ]);
  return raw;
}

/** Uses up a handoff of this kind. The DELETE ... RETURNING makes it single-use even under races. */
export async function redeemHandoff(db: D1Database, kind: HandoffKind, raw: unknown, now = Date.now()): Promise<{ subscriberId: string; intent: Intent | null; created: boolean; challenge: string | null } | null> {
  if (typeof raw !== "string" || !/^[0-9a-f]{64}$/.test(raw)) return null;
  const row = await db
    .prepare("DELETE FROM xanom_handoffs WHERE hash = ? AND kind = ? RETURNING subscriber_id, intent, created, challenge, expires_at")
    .bind(await sha256Hex(raw), kind)
    .first<{ subscriber_id: string; intent: Intent | null; created: number; challenge: string | null; expires_at: number }>();
  if (!row || row.expires_at < now) return null;
  return { subscriberId: row.subscriber_id, intent: row.intent, created: row.created === 1, challenge: row.challenge };
}
