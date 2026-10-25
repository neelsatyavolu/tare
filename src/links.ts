/**
 * Signed links for email: `<subscriberId>.<hmac>`. Nothing is stored, so every digest can carry working
 * manage and unsubscribe links. Each purpose has its own signature, so a manage link can't confirm.
 */
export type LinkPurpose = "confirm" | "manage" | "signin";

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function key(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error("LINK_SECRET must be at least 32 characters.");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signLink(secret: string, purpose: LinkPurpose, id: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await key(secret), new TextEncoder().encode(`${purpose}:${id}`));
  return `${id}.${b64url(sig)}`;
}

/** The subscriber id a token was signed for, or null when it was tampered with or is for another purpose. */
export async function verifyLink(secret: string, purpose: LinkPurpose, token: string): Promise<string | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || token.length > 200) return null;
  const id = token.slice(0, dot);
  const expected = await signLink(secret, purpose, id);
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(token);
  return a.length === b.length && crypto.subtle.timingSafeEqual(a, b) ? id : null;
}

/** Confirm and sign-in links expire, unlike manage links, because they change state or hand out a session. */
export const LINK_TTL_MS = { confirm: 7 * 24 * 3600_000, signin: 30 * 60_000 } as const;
type ExpiringPurpose = keyof typeof LINK_TTL_MS;

export function signExpiring(secret: string, purpose: ExpiringPurpose, id: string, now = Date.now()): Promise<string> {
  return signLink(secret, purpose, `${id}~${now + LINK_TTL_MS[purpose]}`);
}

/** The subscriber id of an unexpired token for this purpose, or null. */
export async function verifyExpiring(secret: string, purpose: ExpiringPurpose, token: string, now = Date.now()): Promise<string | null> {
  const payload = await verifyLink(secret, purpose, token);
  if (!payload) return null;
  const [id, exp] = payload.split("~");
  return id && Number(exp) > now ? id : null;
}
