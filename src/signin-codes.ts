import { sha256Hex } from "./util";

/**
 * Six-digit sign-in codes for the app. A code works for 15 minutes and for five tries; a new code replaces
 * the old one. Only a hash (salted with the account id) is stored.
 */
export const CODE_TTL_MS = 15 * 60_000;
export const MAX_ATTEMPTS = 5;

const hash = (subscriberId: string, code: string) => sha256Hex(`${subscriberId}:${code}`);

export function newCode(): string {
  // Rejection sampling keeps the six digits uniform.
  const [n] = crypto.getRandomValues(new Uint32Array(1));
  return n! >= 4_294_000_000 ? newCode() : String(n! % 1_000_000).padStart(6, "0");
}

export async function saveCode(db: D1Database, subscriberId: string, code: string, now = Date.now()): Promise<void> {
  await db
    .prepare(
      `INSERT INTO signin_codes (subscriber_id, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0)
       ON CONFLICT(subscriber_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0`,
    )
    .bind(subscriberId, await hash(subscriberId, code), now + CODE_TTL_MS)
    .run();
}

/** Uses up the code if it matches. A wrong guess counts against the code; the fifth burns it. */
export async function redeemCode(db: D1Database, subscriberId: string, code: string, now = Date.now()): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const row = await db
    .prepare("SELECT code_hash, expires_at, attempts FROM signin_codes WHERE subscriber_id = ?")
    .bind(subscriberId)
    .first<{ code_hash: string; expires_at: number; attempts: number }>();
  if (!row || row.expires_at < now || row.attempts >= MAX_ATTEMPTS) return false;
  if (row.code_hash !== (await hash(subscriberId, code))) {
    await db.prepare("UPDATE signin_codes SET attempts = attempts + 1 WHERE subscriber_id = ?").bind(subscriberId).run();
    return false;
  }
  // Delete before answering, and only count it if this request did the delete, so a code works once.
  const r = await db.prepare("DELETE FROM signin_codes WHERE subscriber_id = ? AND code_hash = ?").bind(subscriberId, row.code_hash).run();
  return (r.meta.changes ?? 0) === 1;
}
