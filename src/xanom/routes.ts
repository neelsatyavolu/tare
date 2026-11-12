import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { isReviewEmail } from "../api/account";
import type { Env } from "../env";
import { createSession, endSession, sessionSubscriber, sessionToken, setSessionCookie } from "../sessions";
import { findById, type Subscriber } from "../subscribers";
import { createHandoff, linkXanom, redeemHandoff, XANOM_ERRORS, type XanomError } from "./link";
import { authorizeUrl, convertTicket, exchangeCode, FLOW_TTL_MS, isChallenge, isIntent, pkceChallenge, issuerKeys, openFlow, randomToken, safeReturn, sealFlow, verifySummaryToken, type FlowState, type Intent, type Platform, type XanomConfig } from "./oidc";
import { summaryFor } from "./summary";
import { timingSafeEqual } from "../util";

/**
 * "Continue with Xanom" (accounts.xanom.co), for the site and the iOS app:
 *   GET  /api/xanom/start        sign in (site link, or the app's browser sheet with platform=ios)
 *   POST /api/xanom/start        link or convert from the account page (a form, so it's a deliberate click)
 *   GET  /api/xanom/callback     the account service sends the browser back here with a code
 *   POST /api/xanom/ios-start    the signed-in app asks for a one-time start URL to link or convert
 *   POST /api/xanom/ios-exchange the app swaps the one-time ticket from tare://xanom (plus its verifier) for a session token
 *   GET  /api/xanom/summary      the Xanom dashboard's summary card, called by the account service
 */
type App = { Bindings: Env; Variables: { viewer: Subscriber | null; tz: string } };
type C = Context<App>;

export const xanom = new Hono<App>();

const FLOW_COOKIE = "tare_xanom";
const FLOW_PATH = "/api/xanom";

export function xanomConfig(env: Env): XanomConfig | null {
  const { XANOM_ISSUER: issuer, XANOM_CLIENT_ID: clientId, XANOM_CLIENT_SECRET: clientSecret } = env;
  if (!issuer || !clientId || !clientSecret || !env.LINK_SECRET) return null;
  return { issuer: issuer.replace(/\/+$/, ""), clientId, clientSecret, redirectUri: `${env.APP_URL}/api/xanom/callback` };
}

const bearer = (c: C) => c.req.header("authorization")?.match(/^Bearer (\S{20,4000})$/)?.[1];

/** Sends the reader back with a reason: to a page on the site, or to the app through its URL scheme. */
function fail(c: C, platform: Platform, intent: Intent, error: XanomError) {
  if (platform === "ios") return c.redirect(`tare://xanom?error=${error}&message=${encodeURIComponent(XANOM_ERRORS[error])}`, 302);
  return c.redirect(`${intent === "signin" ? "/signin" : "/account"}?xanom=${error}${intent === "signin" ? "" : "#xanom"}`, 303);
}

async function start(c: C, input: { intent: unknown; platform: unknown; returnTo: unknown; handoff: unknown; challenge: unknown }) {
  const platform: Platform = input.platform === "ios" ? "ios" : "web";
  const intent: Intent = isIntent(input.intent) ? input.intent : "signin";
  const cfg = xanomConfig(c.env);
  if (!cfg) return fail(c, platform, intent, "unavailable");
  if (platform === "ios" && !isChallenge(input.challenge)) return fail(c, platform, intent, "failed");

  // Who a link or convert attaches to: the site's signed-in reader, or the app's reader via its one-time handoff.
  let current: Subscriber | null = null;
  if (intent !== "signin") {
    if (platform === "web") {
      if (c.req.method !== "POST") return c.redirect("/account#xanom", 303);
      current = c.get("viewer");
      if (!current) return c.redirect("/signin", 303);
    } else {
      const handoff = await redeemHandoff(c.env.DB, "ios_start", input.handoff);
      current = handoff && handoff.intent === intent ? await findById(c.env.DB, handoff.subscriberId) : null;
      if (!current) return fail(c, platform, intent, "expired");
    }
  }

  const flow: FlowState = {
    state: randomToken(),
    verifier: randomToken(48),
    nonce: randomToken(),
    intent,
    platform,
    returnTo: safeReturn(input.returnTo),
    subscriberId: current?.id ?? null,
    appChallenge: platform === "ios" && isChallenge(input.challenge) ? input.challenge : null,
    exp: Date.now() + FLOW_TTL_MS,
  };
  setCookie(c, FLOW_COOKIE, await sealFlow(c.env.LINK_SECRET!, flow), {
    httpOnly: true, secure: new URL(c.req.url).protocol === "https:", sameSite: "Lax", path: FLOW_PATH, maxAge: FLOW_TTL_MS / 1000,
  });

  const convert =
    intent === "convert" && current
      ? await convertTicket(cfg, {
          email: current.email,
          name: current.email.split("@")[0]!,
          // Every session started from an emailed code or link, so a signed-in reader's address is confirmed.
          // The App Review demo account signs in with a fixed code instead, so it doesn't vouch for its address.
          emailVerified: current.status !== "pending" && !isReviewEmail(c.env, current.email),
        })
      : undefined;
  c.header("cache-control", "no-store");
  return c.redirect(await authorizeUrl(cfg, flow, { convert, loginHint: intent === "convert" ? current?.email : undefined }), 302);
}

xanom.get("/start", (c) => start(c, { intent: c.req.query("intent"), platform: c.req.query("platform"), returnTo: c.req.query("return"), handoff: c.req.query("handoff"), challenge: c.req.query("challenge") }));

xanom.post("/start", async (c) => {
  const form = await c.req.parseBody();
  return start(c, { intent: form.intent, platform: "web", returnTo: form.return, handoff: undefined, challenge: undefined });
});

xanom.get("/callback", async (c) => {
  const cfg = xanomConfig(c.env);
  const flow = cfg ? await openFlow(c.env.LINK_SECRET!, getCookie(c, FLOW_COOKIE)) : null;
  deleteCookie(c, FLOW_COOKIE, { path: FLOW_PATH, secure: new URL(c.req.url).protocol === "https:" });
  c.header("cache-control", "no-store");
  if (!cfg) return fail(c, "web", "signin", "unavailable");
  if (!flow || c.req.query("state") !== flow.state) return fail(c, flow?.platform ?? "web", flow?.intent ?? "signin", "expired");
  const { platform, intent } = flow;

  const providerError = c.req.query("error");
  if (providerError) return fail(c, platform, intent, providerError === "access_denied" || providerError === "login_required" ? "cancelled" : "failed");
  const code = c.req.query("code");
  if (!code || code.length > 512) return fail(c, platform, intent, "failed");

  let who;
  try {
    who = await exchangeCode(cfg, code, flow.verifier, flow.nonce);
  } catch (err) {
    console.error(`xanom sign-in failed: ${err instanceof Error ? err.message : String(err)}`);
    return fail(c, platform, intent, "failed");
  }

  // On the site, a link/convert must finish in the same Tare session it started in.
  const viewer = c.get("viewer");
  if (platform === "web" && intent !== "signin" && viewer?.id !== flow.subscriberId) return fail(c, platform, intent, "signed-out");

  const result = await linkXanom(c.env.DB, who, intent, flow.subscriberId);
  if (!result.ok) return fail(c, platform, intent, result.error);

  if (platform === "ios") {
    const ticket = await createHandoff(c.env.DB, "ios_ticket", result.subscriberId, { created: result.created, challenge: flow.appChallenge ?? undefined });
    return c.redirect(`tare://xanom?ticket=${ticket}`, 302);
  }
  if (viewer && viewer.id !== result.subscriberId) await endSession(c.env.DB, sessionToken(c));
  if (!viewer || viewer.id !== result.subscriberId) setSessionCookie(c, await createSession(c.env.DB, result.subscriberId));
  if (result.created) return c.redirect("/welcome", 303);
  return c.redirect(intent === "signin" ? flow.returnTo : "/account?saved=xanom#xanom", 303);
});

/** The signed-in app asks to link or convert: a one-time URL for its browser sheet. Body: {intent}. */
xanom.post("/ios-start", async (c) => {
  const sub = await sessionSubscriber(c.env.DB, bearer(c));
  if (!sub) return c.json({ error: "signed out" }, 401);
  const intent = ((await c.req.json().catch(() => null)) as { intent?: unknown } | null)?.intent;
  if (intent !== "link" && intent !== "convert") return c.json({ error: "intent must be link or convert" }, 400);
  if (!xanomConfig(c.env)) return c.json({ error: XANOM_ERRORS.unavailable }, 503);
  const handoff = await createHandoff(c.env.DB, "ios_start", sub.id, { intent });
  // The app adds its own &challenge= before opening this.
  return c.json({ url: `${c.env.APP_URL}/api/xanom/start?platform=ios&intent=${intent}&handoff=${handoff}` });
});

/**
 * Body: {ticket, verifier}. The verifier is the one whose challenge the app put on the start URL, so a ticket
 * caught on its way to the app is no use to anyone else. Returns the same session token the emailed code does.
 */
xanom.post("/ios-exchange", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { ticket?: unknown; verifier?: unknown } | null;
  const handoff = await redeemHandoff(c.env.DB, "ios_ticket", body?.ticket);
  const verifier = typeof body?.verifier === "string" && body.verifier.length >= 43 && body.verifier.length <= 128 ? body.verifier : null;
  const bound = !!handoff?.challenge && !!verifier && timingSafeEqual(await pkceChallenge(verifier), handoff.challenge);
  const sub = handoff && bound ? await findById(c.env.DB, handoff.subscriberId) : null;
  if (!handoff || !sub) return c.json({ error: XANOM_ERRORS.expired }, 400);
  return c.json({ token: await createSession(c.env.DB, sub.id), email: sub.email, created: handoff.created });
});

xanom.get("/summary", async (c) => {
  c.header("cache-control", "no-store");
  const cfg = xanomConfig(c.env);
  const token = bearer(c);
  if (!cfg) return c.json({ error: "not configured" }, 503);
  if (!token) return c.json({ error: "unauthorized" }, 401);
  let sub: string;
  try {
    sub = await verifySummaryToken(cfg, token, issuerKeys(cfg.issuer));
  } catch {
    return c.json({ error: "unauthorized" }, 401);
  }
  return c.json(await summaryFor(c.env.DB, sub, c.env.APP_URL));
});
