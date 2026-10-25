import { refresh, type AiTokens } from "./oauth";

// A reader's AI tokens are sealed with AES-GCM under AI_TOKEN_KEY (32 random bytes, base64), with the
// subscriber id bound as additional data so a sealed blob can't be moved to another account.

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error("AI_TOKEN_KEY must be 32 bytes, base64-encoded.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(tokens: AiTokens, keyB64: string, subscriberId: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const params = { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(subscriberId) };
  const cipher = await crypto.subtle.encrypt(params, await importKey(keyB64), new TextEncoder().encode(JSON.stringify(tokens)));
  return `${b64(iv)}.${b64(new Uint8Array(cipher))}`;
}

export async function unseal(sealed: string, keyB64: string, subscriberId: string): Promise<AiTokens | null> {
  const [iv, cipher] = sealed.split(".");
  if (!iv || !cipher) return null;
  try {
    const params = { name: "AES-GCM", iv: unb64(iv), additionalData: new TextEncoder().encode(subscriberId) };
    const plain = await crypto.subtle.decrypt(params, await importKey(keyB64), unb64(cipher));
    const t = JSON.parse(new TextDecoder().decode(plain));
    if (typeof t.accessToken !== "string" || typeof t.refreshToken !== "string" || typeof t.expiresAt !== "number") return null;
    return { ...t, provider: t.provider === "codex" ? "codex" : "grok" };
  } catch {
    return null;
  }
}

export async function saveConnection(db: D1Database, keyB64: string, subscriberId: string, tokens: AiTokens, now = Date.now()): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ai_connections (subscriber_id, provider, sealed, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(subscriber_id) DO UPDATE SET provider = excluded.provider, sealed = excluded.sealed, updated_at = excluded.updated_at`,
    )
    .bind(subscriberId, tokens.provider, await seal(tokens, keyB64, subscriberId), now)
    .run();
}

export async function loadConnection(db: D1Database, keyB64: string, subscriberId: string): Promise<AiTokens | null> {
  const row = await db.prepare("SELECT sealed FROM ai_connections WHERE subscriber_id = ?").bind(subscriberId).first<{ sealed: string }>();
  return row ? unseal(row.sealed, keyB64, subscriberId) : null;
}

export async function connectedProvider(db: D1Database, subscriberId: string): Promise<AiTokens["provider"] | null> {
  const row = await db.prepare("SELECT provider FROM ai_connections WHERE subscriber_id = ?").bind(subscriberId).first<{ provider: string }>();
  return row?.provider === "codex" ? "codex" : row?.provider === "grok" ? "grok" : null;
}

export async function deleteConnection(db: D1Database, subscriberId: string): Promise<void> {
  await db.prepare("DELETE FROM ai_connections WHERE subscriber_id = ?").bind(subscriberId).run();
}

/**
 * Tokens ready to use, refreshed when close to expiry. Providers may rotate refresh tokens, so a failed
 * refresh re-reads the store in case another request already refreshed them.
 */
export async function usableTokens(db: D1Database, keyB64: string, subscriberId: string, now = Date.now()): Promise<AiTokens | null> {
  const tokens = await loadConnection(db, keyB64, subscriberId);
  if (!tokens) return null;
  if (tokens.expiresAt > now + 60_000) return tokens;
  try {
    const fresh = await refresh(tokens);
    await saveConnection(db, keyB64, subscriberId, fresh, now);
    return fresh;
  } catch (err) {
    const latest = await loadConnection(db, keyB64, subscriberId);
    if (latest && latest.expiresAt > now + 60_000) return latest;
    throw err;
  }
}
