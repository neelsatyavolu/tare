import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { findById, type Subscriber } from "./subscribers";
import { sha256Hex } from "./util";

export const SESSION_COOKIE = "tare_session";
export const SESSION_TTL_MS = 60 * 24 * 3600_000;

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Starts a session and returns the raw token for the cookie. Only its hash is stored. */
export async function createSession(db: D1Database, subscriberId: string, now = Date.now()): Promise<string> {
  const token = newToken();
  await db.batch([
    // Opportunistic cleanup keeps the table small without a separate job.
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    db.prepare("INSERT INTO sessions (token_hash, subscriber_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind(await sha256Hex(token), subscriberId, now, now + SESSION_TTL_MS),
  ]);
  return token;
}

export async function sessionSubscriber(db: D1Database, token: string | undefined, now = Date.now()): Promise<Subscriber | null> {
  if (!token || token.length > 100) return null;
  const row = await db
    .prepare("SELECT subscriber_id FROM sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(await sha256Hex(token), now)
    .first<{ subscriber_id: string }>();
  return row ? findById(db, row.subscriber_id) : null;
}

export async function endSession(db: D1Database, token: string | undefined): Promise<void> {
  if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
}

// Cookie helpers. Secure everywhere except plain-http local dev.
const secure = (c: Context) => new URL(c.req.url).protocol === "https:";

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: secure(c), sameSite: "Lax", path: "/", maxAge: SESSION_TTL_MS / 1000 });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: secure(c) });
}

export function sessionToken(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}
