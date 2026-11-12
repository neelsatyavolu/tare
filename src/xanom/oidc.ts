import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTVerifyGetKey } from "jose";
import { timingSafeEqual } from "../util";

/**
 * The OIDC side of "Continue with Xanom" (docs: xanom-accounts SPEC.md §2-4). Tare is a confidential client:
 * the browser only ever carries the authorization code; the id_token comes from a server-to-server exchange.
 */
export type XanomConfig = { issuer: string; clientId: string; clientSecret: string; redirectUri: string };
export type Intent = "signin" | "link" | "convert";
export type Platform = "web" | "ios";

export const isChallenge = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
export const isIntent = (v: unknown): v is Intent => v === "signin" || v === "link" || v === "convert";

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

// ── The flow state, kept in a short-lived signed cookie between /start and /callback ──

export type FlowState = {
  state: string;
  verifier: string;
  nonce: string;
  intent: Intent;
  platform: Platform;
  /** Where a web sign-in lands afterwards (a local path). */
  returnTo: string;
  /** The reader a link/convert attaches to; set at /start. */
  subscriberId: string | null;
  /** iOS: the S256 challenge of the app's verifier; the ticket can only be redeemed with that verifier. */
  appChallenge: string | null;
  exp: number;
};

export const FLOW_TTL_MS = 10 * 60_000;

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`xanom-flow:${data}`))));
}

export async function sealFlow(secret: string, flow: FlowState): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(flow)));
  return `${body}.${await hmac(secret, body)}`;
}

export async function openFlow(secret: string, cookie: string | undefined, now = Date.now()): Promise<FlowState | null> {
  if (!cookie || cookie.length > 2000) return null;
  const [body, sig] = cookie.split(".");
  if (!body || !sig || !timingSafeEqual(sig, await hmac(secret, body))) return null;
  try {
    const flow = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/"))) as FlowState;
    return typeof flow.exp === "number" && flow.exp > now && isIntent(flow.intent) ? flow : null;
  } catch {
    return null;
  }
}

/** A local path to return to after sign-in; anything else (other hosts, `//x`, `/\x`) becomes the default. */
export function safeReturn(raw: unknown, fallback = "/account"): string {
  return typeof raw === "string" && /^\/(?![/\\])[^\s]{0,200}$/.test(raw) ? raw : fallback;
}

export async function authorizeUrl(cfg: XanomConfig, flow: FlowState, extra: { convert?: string; loginHint?: string } = {}): Promise<string> {
  const url = new URL(`${cfg.issuer}/oauth/authorize`);
  const params: Record<string, string> = {
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: "openid email profile",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: await pkceChallenge(flow.verifier),
    code_challenge_method: "S256",
  };
  if (extra.convert) params.convert = extra.convert;
  if (extra.loginHint) params.login_hint = extra.loginHint;
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

// ── Keys and tokens ─────────────────────────────────────────────────────

// One key set per issuer per isolate; jose refetches after 10 minutes, or sooner for an unknown kid.
const keySets = new Map<string, JWTVerifyGetKey>();
export function issuerKeys(issuer: string): JWTVerifyGetKey {
  let keys = keySets.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/oauth/jwks`), { cacheMaxAge: 10 * 60_000, cooldownDuration: 30_000, timeoutDuration: 3000 });
    keySets.set(issuer, keys);
  }
  return keys;
}

export type XanomIdentity = { sub: string; email: string; emailVerified: boolean; name: string | null };

/** Swaps the code for tokens and returns the verified identity. Throws on any failure. */
export async function exchangeCode(cfg: XanomConfig, code: string, verifier: string, nonce: string, keys = issuerKeys(cfg.issuer)): Promise<XanomIdentity> {
  const res = await fetch(`${cfg.issuer}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`token endpoint answered ${res.status}`);
  const idToken = ((await res.json()) as { id_token?: unknown }).id_token;
  if (typeof idToken !== "string") throw new Error("no id_token in the token response");
  return verifyIdToken(cfg, idToken, nonce, keys);
}

export async function verifyIdToken(cfg: Pick<XanomConfig, "issuer" | "clientId">, idToken: string, nonce: string, keys: JWTVerifyGetKey): Promise<XanomIdentity> {
  const { payload } = await jwtVerify(idToken, keys, {
    issuer: cfg.issuer,
    audience: cfg.clientId,
    algorithms: ["RS256"],
    requiredClaims: ["sub", "exp", "iat"],
  });
  if (typeof payload.nonce !== "string" || !timingSafeEqual(payload.nonce, nonce)) throw new Error("nonce mismatch");
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("no sub");
  if (typeof payload.email !== "string" || !payload.email.includes("@")) throw new Error("no email");
  return {
    sub: payload.sub,
    email: payload.email.trim().toLowerCase(),
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === "string" ? payload.name : null,
  };
}

/** Verifies the account service's call to the summary endpoint (§4). Returns the Xanom sub, or throws. */
export async function verifySummaryToken(cfg: Pick<XanomConfig, "issuer" | "clientId">, token: string, keys: JWTVerifyGetKey): Promise<string> {
  const { payload } = await jwtVerify(token, keys, {
    issuer: cfg.issuer,
    audience: cfg.clientId,
    algorithms: ["RS256"],
    requiredClaims: ["sub", "exp", "iat"],
    maxTokenAge: "5m",
  });
  if (payload.scope !== "summary") throw new Error("wrong scope");
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("no sub");
  return payload.sub;
}

/**
 * The convert ticket (§3): HS256 with the client secret, telling the account service which address to make
 * an account for and whether Tare has confirmed it.
 */
export async function convertTicket(cfg: XanomConfig, who: { email: string; name: string; emailVerified: boolean }, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  return new SignJWT({ email: who.email, name: who.name, email_verified: who.emailVerified })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(cfg.clientId)
    .setAudience(cfg.issuer)
    .setJti(crypto.randomUUID())
    .setIssuedAt(iat)
    .setExpirationTime(iat + 300)
    .sign(new TextEncoder().encode(cfg.clientSecret));
}
