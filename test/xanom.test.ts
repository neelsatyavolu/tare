import { env } from "cloudflare:workers";
import { exportJWK, generateKeyPair, jwtVerify, SignJWT, type CryptoKey as JoseKey } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/index";
import { createSession, SESSION_COOKIE } from "../src/sessions";
import { findById } from "../src/subscribers";
import { linkXanom, type LinkResult } from "../src/xanom/link";
import { convertTicket, openFlow, pkceChallenge, randomToken, safeReturn } from "../src/xanom/oidc";

const ISSUER = "https://accounts.test";
const CLIENT = "tare";
const SECRET = "test-xanom-client-secret";
const KID = "k1";

let keys: { privateKey: JoseKey; publicKey: JoseKey };
let otherKeys: { privateKey: JoseKey; publicKey: JoseKey };
let jwks: unknown;

beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  otherKeys = await generateKeyPair("RS256");
  jwks = { keys: [{ ...(await exportJWK(keys.publicKey)), kid: KID, alg: "RS256", use: "sig" }] };
});

const req = (path: string, init?: RequestInit) => app.request(path, init, env);

async function signed(claims: Record<string, unknown>, opts: { key?: JoseKey; aud?: string; iss?: string; expSec?: number; iatSec?: number } = {}) {
  const iat = opts.iatSec ?? Math.floor(Date.now() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? CLIENT)
    .setIssuedAt(iat)
    .setExpirationTime(opts.expSec ?? iat + 600)
    .sign(opts.key ?? keys.privateKey);
}

// The fake account service: serves the JWKS, and answers the token endpoint with whatever id_token is queued.
let idTokenFor: (form: URLSearchParams) => Promise<string>;
let tokenRequests: URLSearchParams[] = [];
beforeEach(async () => {
  tokenRequests = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === `${ISSUER}/oauth/jwks`) return Response.json(jwks);
    if (url === `${ISSUER}/oauth/token`) {
      const form = new URLSearchParams(String(init?.body));
      tokenRequests.push(form);
      return Response.json({ id_token: await idTokenFor(form), access_token: "x", token_type: "Bearer", expires_in: 600 });
    }
    return new Response("not found", { status: 404 });
  });
  await env.DB.exec("DELETE FROM subscribers; DELETE FROM sessions; DELETE FROM xanom_handoffs; DELETE FROM signin_codes");
});
afterEach(() => vi.restoreAllMocks());

async function addReader(email: string, status = "unsubscribed", xanomSub: string | null = null) {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO subscribers (id, email, topics, status, created_at, xanom_sub) VALUES (?, ?, '[]', ?, 0, ?)").bind(id, email, status, xanomSub).run();
  return id;
}

const who = (sub: string, email: string, emailVerified = true) => ({ sub, email, emailVerified, name: "Reader" });
const subOf = async (id: string) => (await env.DB.prepare("SELECT xanom_sub FROM subscribers WHERE id = ?").bind(id).first<{ xanom_sub: string | null }>())?.xanom_sub;

describe("linking rules", () => {
  it("1: signs in the reader already linked to this Xanom account", async () => {
    const id = await addReader("a@x.test", "active", "xa_1");
    expect(await linkXanom(env.DB, who("xa_1", "other@x.test"), "signin", null)).toEqual({ ok: true, subscriberId: id, created: false });
  });

  it("1: refuses to link an account that's already on another reader", async () => {
    await addReader("a@x.test", "active", "xa_1");
    const me = await addReader("b@x.test");
    expect(await linkXanom(env.DB, who("xa_1", "a@x.test"), "link", me)).toEqual({ ok: false, error: "taken" });
  });

  it("2: link attaches the account to the signed-in reader, even under another email", async () => {
    const me = await addReader("me@x.test");
    await addReader("xanom@x.test"); // a different reader with the Xanom email is not touched
    const r = await linkXanom(env.DB, who("xa_2", "xanom@x.test"), "link", me);
    expect(r).toEqual({ ok: true, subscriberId: me, created: false });
    expect(await subOf(me)).toBe("xa_2");
  });

  it("2: convert needs the same email", async () => {
    const me = await addReader("me@x.test");
    expect(await linkXanom(env.DB, who("xa_3", "else@x.test"), "convert", me)).toEqual({ ok: false, error: "email-mismatch" });
    expect(await linkXanom(env.DB, who("xa_3", "me@x.test"), "convert", me)).toEqual({ ok: true, subscriberId: me, created: false });
  });

  it("2: won't replace a different Xanom account on the signed-in reader", async () => {
    const me = await addReader("me@x.test", "unsubscribed", "xa_old");
    expect(await linkXanom(env.DB, who("xa_new", "me@x.test"), "link", me)).toEqual({ ok: false, error: "other-link" });
  });

  it("3: attaches to the reader with the same email and signs them in", async () => {
    const id = await addReader("same@x.test", "active");
    expect(await linkXanom(env.DB, who("xa_4", "same@x.test"), "signin", null)).toEqual({ ok: true, subscriberId: id, created: false });
    expect(await subOf(id)).toBe("xa_4");
  });

  it("3 guard: an address Tare never confirmed is confirmed, and anything left on it is revoked", async () => {
    const id = await addReader("typed@x.test", "pending");
    // Can't happen through Tare's own flows, but if it ever did, the session must not survive.
    await createSession(env.DB, id);
    await env.DB.prepare("INSERT INTO signin_codes (subscriber_id, code_hash, expires_at) VALUES (?, 'h', ?)").bind(id, Date.now() + 60_000).run();
    const r = await linkXanom(env.DB, who("xa_5", "typed@x.test"), "signin", null);
    expect(r).toEqual({ ok: true, subscriberId: id, created: true });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE subscriber_id = ?").bind(id).first<{ n: number }>())!.n).toBe(0);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM signin_codes WHERE subscriber_id = ?").bind(id).first<{ n: number }>())!.n).toBe(0);
    expect((await findById(env.DB, id))!.status).toBe("unsubscribed");
  });

  it("3: an unverified Xanom email can't claim an existing account", async () => {
    await addReader("same@x.test", "active");
    expect(await linkXanom(env.DB, who("xa_6", "same@x.test", false), "signin", null)).toEqual({ ok: false, error: "unverified" });
  });

  it("4: makes a new confirmed reader with email off", async () => {
    const r = (await linkXanom(env.DB, who("xa_7", "new@x.test"), "signin", null)) as Extract<LinkResult, { ok: true }>;
    expect(r.ok && r.created).toBe(true);
    const sub = await findById(env.DB, r.subscriberId);
    expect(sub).toMatchObject({ email: "new@x.test", status: "unsubscribed", topics: [] });
    expect(await subOf(r.subscriberId)).toBe("xa_7");
  });
});

// ── The web flow: /start → account service → /callback ─────────────────

const cookieFrom = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`))?.split(";")[0]!.slice(name.length + 1);

async function startFlow(path = "/api/xanom/start?intent=signin", init?: RequestInit) {
  const res = await req(path, init);
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get("location")!);
  const cookie = cookieFrom(res, "tare_xanom")!;
  return { res, location, cookie, flow: (await openFlow(env.LINK_SECRET!, cookie))! };
}

function queueIdentity(sub: string, email: string, extra: Record<string, unknown> = {}) {
  idTokenFor = async (form) => {
    void form;
    return signed({ sub, email, email_verified: true, name: "Reader", nonce: currentNonce, ...extra });
  };
}
let currentNonce = "";

const callback = (state: string, cookie: string | undefined, more = "", session?: string) =>
  req(`/api/xanom/callback?code=abc&state=${state}${more}`, { headers: { cookie: [cookie ? `tare_xanom=${cookie}` : "", session ? `${SESSION_COOKIE}=${session}` : ""].filter(Boolean).join("; ") } });

describe("start and callback", () => {
  it("redirects to the authorize endpoint with state, nonce and an S256 PKCE challenge", async () => {
    const { location, flow, res } = await startFlow("/api/xanom/start?intent=signin&return=/s/abc");
    expect(location.origin + location.pathname).toBe(`${ISSUER}/oauth/authorize`);
    const q = location.searchParams;
    expect(q.get("response_type")).toBe("code");
    expect(q.get("client_id")).toBe(CLIENT);
    expect(q.get("redirect_uri")).toBe("http://localhost:8787/api/xanom/callback");
    expect(q.get("scope")).toBe("openid email profile");
    expect(q.get("state")).toBe(flow.state);
    expect(q.get("nonce")).toBe(flow.nonce);
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).toBe(await pkceChallenge(flow.verifier));
    expect(flow.returnTo).toBe("/s/abc");
    expect(res.headers.getSetCookie()[0]).toMatch(/HttpOnly/i);
  });

  it("signs a new reader in and sends them to the welcome steps", async () => {
    const { flow, cookie } = await startFlow();
    currentNonce = flow.nonce;
    queueIdentity("xa_web", "web@x.test");
    const res = await callback(flow.state, cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/welcome");
    expect(cookieFrom(res, SESSION_COOKIE)).toBeTruthy();
    expect(tokenRequests[0]!.get("code_verifier")).toBe(flow.verifier);
    expect(tokenRequests[0]!.get("client_secret")).toBe(SECRET);
  });

  it("refuses a callback whose state doesn't match, or with no flow cookie", async () => {
    const { flow, cookie } = await startFlow();
    currentNonce = flow.nonce;
    queueIdentity("xa_s", "s@x.test");
    expect((await callback("wrong", cookie)).headers.get("location")).toBe("/signin?xanom=expired");
    expect((await callback(flow.state, undefined)).headers.get("location")).toBe("/signin?xanom=expired");
    expect(tokenRequests).toHaveLength(0);
  });

  it("refuses an id_token with the wrong nonce, audience, issuer or signature", async () => {
    for (const [label, mk] of [
      ["nonce", () => signed({ sub: "xa_n", email: "n@x.test", email_verified: true, nonce: "not-it" })],
      ["aud", () => signed({ sub: "xa_n", email: "n@x.test", email_verified: true, nonce: currentNonce }, { aud: "mullwell" })],
      ["iss", () => signed({ sub: "xa_n", email: "n@x.test", email_verified: true, nonce: currentNonce }, { iss: "https://evil.test" })],
      ["sig", () => signed({ sub: "xa_n", email: "n@x.test", email_verified: true, nonce: currentNonce }, { key: otherKeys.privateKey })],
      ["exp", () => signed({ sub: "xa_n", email: "n@x.test", email_verified: true, nonce: currentNonce }, { iatSec: 1000, expSec: 1600 })],
    ] as const) {
      const { flow, cookie } = await startFlow();
      currentNonce = flow.nonce;
      idTokenFor = mk;
      vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await callback(flow.state, cookie);
      expect(res.headers.get("location"), label).toBe("/signin?xanom=failed");
      expect(cookieFrom(res, SESSION_COOKIE), label).toBeFalsy();
    }
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM subscribers").first("n")).toBe(0);
  });

  it("treats a cancelled sign-in as cancelled", async () => {
    const { flow, cookie } = await startFlow();
    const res = await req(`/api/xanom/callback?error=access_denied&state=${flow.state}`, { headers: { cookie: `tare_xanom=${cookie}` } });
    expect(res.headers.get("location")).toBe("/signin?xanom=cancelled");
  });

  it("only returns to local paths", () => {
    expect(safeReturn("/s/abc")).toBe("/s/abc");
    for (const bad of ["//evil.test", "/\\evil.test", "https://evil.test", "", 3]) expect(safeReturn(bad)).toBe("/account");
  });
});

describe("link and convert on the site", () => {
  const post = (intent: string, session?: string) =>
    req("/api/xanom/start", {
      method: "POST",
      body: new URLSearchParams({ intent }),
      headers: { "content-type": "application/x-www-form-urlencoded", ...(session ? { cookie: `${SESSION_COOKIE}=${session}` } : {}) },
    });

  it("needs a signed-in reader and a POST", async () => {
    expect((await post("link")).headers.get("location")).toBe("/signin");
    expect((await req("/api/xanom/start?intent=link")).headers.get("location")).toBe("/account#xanom");
  });

  it("convert sends a signed ticket for the reader's confirmed address, then links on return", async () => {
    const me = await addReader("me@x.test");
    const session = await createSession(env.DB, me);
    const res = await post("convert", session);
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("login_hint")).toBe("me@x.test");
    const ticket = location.searchParams.get("convert")!;
    const [header] = ticket.split(".");
    expect(JSON.parse(atob(header!))).toEqual({ alg: "HS256", typ: "JWT" });
    const { payload } = await jwtVerify(ticket, new TextEncoder().encode(SECRET), { issuer: CLIENT, audience: ISSUER, algorithms: ["HS256"] });
    expect(payload).toMatchObject({ email: "me@x.test", email_verified: true, name: "me" });
    expect(payload.exp! - payload.iat!).toBe(300);
    expect(typeof payload.jti).toBe("string");

    const flow = (await openFlow(env.LINK_SECRET!, cookieFrom(res, "tare_xanom")))!;
    currentNonce = flow.nonce;
    queueIdentity("xa_conv", "me@x.test");
    const back = await callback(flow.state, cookieFrom(res, "tare_xanom"), "", session);
    expect(back.headers.get("location")).toBe("/account?saved=xanom#xanom");
    expect(await subOf(me)).toBe("xa_conv");
    const page = await (await req("/account", { headers: { cookie: `${SESSION_COOKIE}=${session}` } })).text();
    expect(page).toContain("Signed in with Xanom · <b>me@x.test</b>");
    expect(page).toContain("Manage at accounts.xanom.co");
  });

  it("a ticket made with another secret doesn't verify", async () => {
    const t = await convertTicket({ issuer: ISSUER, clientId: CLIENT, clientSecret: "not-the-secret", redirectUri: "x" }, { email: "a@x.test", name: "a", emailVerified: true });
    await expect(jwtVerify(t, new TextEncoder().encode(SECRET))).rejects.toThrow();
  });

  it("refuses to finish a link in a different Tare session than it started in", async () => {
    const me = await addReader("me@x.test");
    const res = await post("link", await createSession(env.DB, me));
    const flow = (await openFlow(env.LINK_SECRET!, cookieFrom(res, "tare_xanom")))!;
    currentNonce = flow.nonce;
    queueIdentity("xa_l", "l@x.test");
    const back = await callback(flow.state, cookieFrom(res, "tare_xanom"));
    expect(back.headers.get("location")).toBe("/account?xanom=signed-out#xanom");
    expect(await subOf(me)).toBeNull();
  });
});

const VERIFIER = randomToken(48);
let CHALLENGE = "";
beforeAll(async () => {
  CHALLENGE = await pkceChallenge(VERIFIER);
});

describe("iOS", () => {
  it("signs in through the browser sheet and swaps the one-time ticket for a session", async () => {
    const { flow, cookie } = await startFlow(`/api/xanom/start?intent=signin&platform=ios&challenge=${CHALLENGE}`);
    currentNonce = flow.nonce;
    queueIdentity("xa_ios", "ios@x.test");
    const back = await callback(flow.state, cookie);
    const location = back.headers.get("location")!;
    expect(location).toMatch(/^tare:\/\/xanom\?ticket=[0-9a-f]{64}$/);
    const ticket = new URL(location).searchParams.get("ticket");
    const exchange = (verifier: string) => req("/api/xanom/ios-exchange", { method: "POST", body: JSON.stringify({ ticket, verifier }), headers: { "content-type": "application/json" } });
    const first = await exchange(VERIFIER);
    const body = (await first.json()) as { token: string; email: string; created: boolean };
    expect(body).toMatchObject({ email: "ios@x.test", created: true });
    const me = await req("/api/v1/me", { headers: { authorization: `Bearer ${body.token}` } });
    expect(await me.json()).toMatchObject({ email: "ios@x.test", xanom: { email: "ios@x.test" } });
    expect((await exchange(VERIFIER)).status).toBe(400);
  });

  it("a ticket is useless without the app's verifier, and burns on a wrong one", async () => {
    const { flow, cookie } = await startFlow(`/api/xanom/start?intent=signin&platform=ios&challenge=${CHALLENGE}`);
    currentNonce = flow.nonce;
    queueIdentity("xa_v", "v@x.test");
    const ticket = new URL((await callback(flow.state, cookie)).headers.get("location")!).searchParams.get("ticket");
    const exchange = (verifier?: string) => req("/api/xanom/ios-exchange", { method: "POST", body: JSON.stringify({ ticket, verifier }), headers: { "content-type": "application/json" } });
    expect((await exchange(randomToken(48))).status).toBe(400);
    expect((await exchange(VERIFIER)).status).toBe(400);
  });

  it("the browser sheet must bring a challenge", async () => {
    expect((await req("/api/xanom/start?intent=signin&platform=ios")).headers.get("location")).toMatch(/^tare:\/\/xanom\?error=failed/);
  });

  it("errors go back to the app through its URL scheme", async () => {
    const { flow, cookie } = await startFlow(`/api/xanom/start?intent=signin&platform=ios&challenge=${CHALLENGE}`);
    const res = await req(`/api/xanom/callback?error=access_denied&state=${flow.state}`, { headers: { cookie: `tare_xanom=${cookie}` } });
    expect(res.headers.get("location")).toMatch(/^tare:\/\/xanom\?error=cancelled&message=/);
  });

  it("link starts from a one-time URL the signed-in app asks for", async () => {
    const me = await addReader("me@x.test");
    const token = await createSession(env.DB, me);
    const ask = (auth?: string) => req("/api/xanom/ios-start", { method: "POST", body: JSON.stringify({ intent: "link" }), headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) } });
    expect((await ask()).status).toBe(401);
    const { url } = (await (await ask(token)).json()) as { url: string };
    const path = `${url.replace("http://localhost:8787", "")}&challenge=${CHALLENGE}`;
    const { flow, cookie } = await startFlow(path);
    expect(flow.subscriberId).toBe(me);
    // The handoff works once.
    expect((await req(path)).headers.get("location")).toMatch(/^tare:\/\/xanom\?error=expired/);
    currentNonce = flow.nonce;
    queueIdentity("xa_il", "other@x.test");
    const back = await callback(flow.state, cookie);
    expect(back.headers.get("location")).toMatch(/^tare:\/\/xanom\?ticket=/);
    expect(await subOf(me)).toBe("xa_il");
  });
});

describe("summary endpoint", () => {
  const summary = (token?: string) => req("/api/xanom/summary", token ? { headers: { authorization: `Bearer ${token}` } } : undefined);

  it("answers a good token with counts and recent briefings", async () => {
    const id = await addReader("s@x.test", "active", "xa_sum");
    await env.DB.prepare("UPDATE subscribers SET topics = '[\"politics\",\"ai\"]' WHERE id = ?").bind(id).run();
    await env.DB.exec("DELETE FROM briefings; DELETE FROM stories");
    await env.DB.prepare("INSERT OR IGNORE INTO editions (date, number, status, item_count) VALUES ('2026-11-10', 1, 'ready', 1)").run();
    await env.DB.prepare("INSERT INTO stories (id, edition_date, rank, front, topic, headline, summary, differences, coverage, item_ids) VALUES ('st1', '2026-11-10', 0, 1, 'politics', 'Senate passes bill', '[]', '[]', '{}', '[]')").run();
    await env.DB.prepare("INSERT INTO briefings (story_id, status, requested_by, requested_at) VALUES ('st1', 'ready', ?, 1762797600000)").bind(id).run();
    const res = await summary(await signed({ sub: "xa_sum", scope: "summary" }, { expSec: Math.floor(Date.now() / 1000) + 60 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      linked: true,
      headline: "2 topics · 1 briefing · email on",
      items: [
        { label: "Topics followed", value: "2" },
        { label: "Detailed briefings", value: "1" },
        { label: "Email editions", value: "Morning and evening" },
      ],
      recent: [{ title: "Senate passes bill", url: "http://localhost:8787/s/st1", at: "2025-11-10T18:00:00.000Z" }],
      url: "http://localhost:8787/",
    });
  });

  it("says linked: false for an unknown sub", async () => {
    expect(await (await summary(await signed({ sub: "xa_nobody", scope: "summary" }))).json()).toEqual({ linked: false });
  });

  it("rejects unsigned, wrong audience, expired, badly signed and wrong-scope tokens", async () => {
    await addReader("s@x.test", "active", "xa_sum");
    const now = Math.floor(Date.now() / 1000);
    const bad = [
      undefined,
      `${btoa('{"alg":"none"}')}.${btoa('{"sub":"xa_sum","scope":"summary"}')}.`,
      await signed({ sub: "xa_sum", scope: "summary" }, { aud: "mullwell" }),
      await signed({ sub: "xa_sum", scope: "summary" }, { iatSec: now - 600, expSec: now - 540 }),
      await signed({ sub: "xa_sum", scope: "summary" }, { key: otherKeys.privateKey }),
      await signed({ sub: "xa_sum", scope: "openid" }),
    ];
    for (const token of bad) expect((await summary(token)).status).toBe(401);
  });
});

describe("pages", () => {
  it("sign-in leads with Continue with Xanom and keeps the email form", async () => {
    const html = await (await req("/signin")).text();
    expect(html).toContain('href="/api/xanom/start?intent=signin"');
    expect(html.indexOf("Continue with Xanom")).toBeLessThan(html.indexOf("Email me a sign-in link"));
    expect(html).toContain('action="/signin"');
  });

  it("an unlinked account page offers convert and link, and CSP lets those forms reach the account service", async () => {
    const res = await req("/account", { headers: { cookie: `${SESSION_COOKIE}=${await createSession(env.DB, await addReader("me@x.test"))}` } });
    const html = await res.text();
    expect(html).toContain("Convert to Xanom account");
    expect(html).toContain("Link an existing Xanom account");
    expect(res.headers.get("content-security-policy")).toContain(`form-action 'self' ${ISSUER}`);
  });
});
