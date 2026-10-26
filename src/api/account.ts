import { Hono, type Context } from "hono";
import { PROVIDER_LABEL } from "../ai/oauth";
import { connectedProvider } from "../ai/vault";
import { loadBriefing, requestBriefing, STALE_MS } from "../briefing";
import { storyById } from "../editions";
import type { Env } from "../env";
import { sendOne } from "../mail/resend";
import { requireSecrets } from "../mail/send";
import { signinCodeEmail } from "../mail/templates";
import { autoBriefingsOn, setAutoBriefings } from "../auto-briefings";
import { createSession, endSession, sessionSubscriber } from "../sessions";
import { newCode, redeemCode, saveCode } from "../signin-codes";
import { deleteAccount, findByEmail, parseEmail, releaseEmailClaim, requestSignin, verifyEmail } from "../subscribers";
import { timingSafeEqual } from "../util";

/**
 * The app's account routes: sign in with an emailed code, then use the reader's account (and the Grok or
 * ChatGPT they connected on the site) with a bearer token. The token is a normal Tare session.
 */
export const account = new Hono<{ Bindings: Env }>();

const bearer = (c: Context<{ Bindings: Env }>) => c.req.header("authorization")?.match(/^Bearer (\S{20,100})$/)?.[1];
const viewer = (c: Context<{ Bindings: Env }>) => sessionSubscriber(c.env.DB, bearer(c));

async function slowDown(c: Context<{ Bindings: Env }>) {
  const { success } = await c.env.SIGNUP_LIMIT.limit({ key: c.req.header("cf-connecting-ip") ?? "unknown" });
  return success ? null : c.json({ error: "Too many tries from here. Wait a minute and try again." }, 429);
}

/** App Review's demo account (REVIEW_EMAIL) signs in with a fixed code (REVIEW_CODE) instead of an emailed one. */
const isReviewEmail = (env: Env, email: string) => !!env.REVIEW_EMAIL && !!env.REVIEW_CODE && email === env.REVIEW_EMAIL.toLowerCase();

/** Emails a sign-in code. Answers the same whether or not the address has an account. */
account.post("/signin", async (c) => {
  const limited = await slowDown(c);
  if (limited) return limited;
  const email = parseEmail(((await c.req.json().catch(() => null)) as { email?: unknown } | null)?.email);
  if (!email) return c.json({ error: "That doesn't look like an email address." }, 400);
  const outcome = await requestSignin(c.env.DB, email);
  if (outcome.send && !isReviewEmail(c.env, email)) {
    const code = newCode();
    await saveCode(c.env.DB, outcome.id, code);
    try {
      await sendOne(requireSecrets(c.env).apiKey, { from: c.env.MAIL_FROM, to: email, ...signinCodeEmail(code) });
    } catch (err) {
      console.error(`code mail failed: ${err instanceof Error ? err.message : String(err)}`);
      await releaseEmailClaim(c.env.DB, outcome.id, outcome.previous, outcome.claimedAt);
      return c.json({ error: "We couldn't send the email just now. Try again in a moment." }, 502);
    }
  }
  return c.json({ ok: true });
});

account.post("/signin/verify", async (c) => {
  const limited = await slowDown(c);
  if (limited) return limited;
  const body = (await c.req.json().catch(() => null)) as { email?: unknown; code?: unknown } | null;
  const email = parseEmail(body?.email);
  const code = typeof body?.code === "string" ? body.code.replace(/\s+/g, "") : "";
  const sub = email ? await findByEmail(c.env.DB, email) : null;
  const ok = sub && (isReviewEmail(c.env, sub.email) ? timingSafeEqual(code, c.env.REVIEW_CODE!) : await redeemCode(c.env.DB, sub.id, code));
  if (!sub || !ok) return c.json({ error: "That code didn't work. Check it, or ask for a new one." }, 400);
  await verifyEmail(c.env.DB, sub.id);
  return c.json({ token: await createSession(c.env.DB, sub.id), email: sub.email });
});

account.get("/me", async (c) => {
  const sub = await viewer(c);
  if (!sub) return c.json({ error: "signed out" }, 401);
  const [provider, auto] = await Promise.all([connectedProvider(c.env.DB, sub.id), autoBriefingsOn(c.env.DB, sub.id)]);
  return c.json({ email: sub.email, ai: provider ? { provider, name: PROVIDER_LABEL[provider], autoBriefings: auto } : null });
});

/** Turns automatic briefings on or off. Body: {on: boolean}. */
account.post("/me/auto-briefings", async (c) => {
  const sub = await viewer(c);
  if (!sub) return c.json({ error: "signed out" }, 401);
  if (!(await connectedProvider(c.env.DB, sub.id))) return c.json({ error: "Connect Grok or ChatGPT on tare.news first.", connect: true }, 409);
  const on = ((await c.req.json().catch(() => null)) as { on?: unknown } | null)?.on === true;
  await setAutoBriefings(c.env.DB, sub.id, on);
  return c.json({ ok: true, autoBriefings: on });
});

/** Deletes the signed-in reader's account, its sessions and any connected AI account. */
account.delete("/me", async (c) => {
  const sub = await viewer(c);
  if (!sub) return c.json({ error: "signed out" }, 401);
  await deleteAccount(c.env.DB, sub.id);
  return c.json({ ok: true });
});

account.post("/signout", async (c) => {
  await endSession(c.env.DB, bearer(c));
  return c.json({ ok: true });
});

/** A story's detailed briefing: ready, being written, failed, or none yet. Written ones are public. */
account.get("/stories/:id/briefing", async (c) => {
  const row = await loadBriefing(c.env.DB, c.req.param("id"));
  if (!row) return c.json({ status: "none" });
  const status = row.status === "writing" && Date.now() - row.requestedAt >= STALE_MS ? "failed" : row.status;
  return c.json({
    status,
    provider: row.provider && row.provider in PROVIDER_LABEL ? PROVIDER_LABEL[row.provider as keyof typeof PROVIDER_LABEL] : null,
    error: status === "failed" ? (row.error ?? "The briefing didn't finish. Try again.") : null,
    sections: row.body?.sections ?? [],
    web: row.body?.web ?? [],
  });
});

/** Asks for a briefing, written with the signed-in reader's connected Grok or ChatGPT. */
account.post("/stories/:id/briefing", async (c) => {
  const sub = await viewer(c);
  if (!sub) return c.json({ error: "Sign in to ask for a briefing." }, 401);
  const story = await storyById(c.env.DB, c.req.param("id"));
  if (!story) return c.json({ error: "not found" }, 404);
  if (!(await connectedProvider(c.env.DB, sub.id))) return c.json({ error: "Connect Grok or ChatGPT on tare.news first.", connect: true }, 409);
  await requestBriefing(c.env, story.id, sub.id);
  return c.json({ status: "writing" });
});
