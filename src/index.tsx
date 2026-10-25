import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { exchange, isProvider, PROVIDER_LABEL, readCallback, startSignIn, type AiProvider } from "./ai/oauth";
import { connectedProvider, deleteConnection, saveConnection } from "./ai/vault";
import { loadBriefing, requestBriefing, runBriefing, type BriefingJob } from "./briefing";
import { AiPaste } from "./web/ai";
import type { Child } from "hono/jsx";
import { editionByDate, latestEdition, listEditions, sourcesFor, storiesFor, storyById } from "./editions";
import type { Env } from "./env";
import { JOBS, runCron, type JobName } from "./jobs";
import { signExpiring, signLink, verifyExpiring, verifyLink } from "./links";
import { sendOne } from "./mail/resend";
import { requireSecrets } from "./mail/send";
import { confirmEmail, digestEmail, digestFor, manageEmail, signinEmail } from "./mail/templates";
import { clearSessionCookie, createSession, endSession, sessionSubscriber, sessionToken, setSessionCookie } from "./sessions";
import {
  confirm, deleteAccount, findById, parseEmail, parseTopics, releaseEmailClaim, requestSignin, setDigest, setTopics, signUp, unsubscribe,
  verifyEmail, type EmailOutcome, type Subscriber,
} from "./subscribers";
import { timingSafeEqual, utcDate } from "./util";
import { Layout, SubscribeForm, ViewerContext } from "./web/components";
import { ICON } from "./web/icon";
import {
  AccountPage, ArchivePage, EditionPage, EmptyPage, ManagePage, MessagePage, MethodPage, SignInPage, StoryPage, UnsubscribeConfirmPage,
} from "./web/pages";
import { CSS } from "./web/styles";
import { readFirst } from "./read-first";
import { rewriteSample } from "./admin-debug";
import { parseReport, recentReports, REPORT_MAX, REPORT_MIN, saveReport } from "./reports";

type App = { Bindings: Env; Variables: { viewer: Subscriber | null } };
const app = new Hono<App>();

const CSP = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  // Story photos load from the outlets' own servers.
  "img-src 'self' data: https:",
  "script-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join("; ");

app.use(async (c, next) => {
  await next();
  c.header("content-security-policy", CSP);
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "strict-origin-when-cross-origin");
  c.header("permissions-policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
});

// Cross-site form posts are refused. SameSite=Lax already keeps the session cookie off them; this also
// covers the token-in-URL forms. Requests without an Origin header (mail providers' one-click unsubscribe,
// the admin API) pass.
app.use(async (c, next) => {
  const origin = c.req.header("origin");
  if (c.req.method === "POST" && origin && origin !== new URL(c.req.url).origin) return c.text("Cross-site request refused.", 403);
  await next();
});

// Loads the signed-in reader, if there's a session cookie. Static files skip the lookup.
app.use(async (c, next) => {
  const token = sessionToken(c);
  c.set("viewer", token ? await sessionSubscriber(c.env.DB, token) : null);
  await next();
});

/** Renders a page for this request's reader. Pages vary by sign-in, so browsers must revalidate them. */
function page(c: Context<App>, node: Child, status: 200 | 400 | 404 | 429 | 500 | 502 = 200) {
  c.header("cache-control", "private, no-cache");
  return c.html(<ViewerContext.Provider value={c.get("viewer")}>{node}</ViewerContext.Provider>, status);
}

const formTopics = (raw: unknown) => parseTopics(Array.isArray(raw) ? raw : raw ? [raw] : []);

app.get("/styles.css", (c) => {
  // The URL carries a content hash (CSS_VERSION), so it can be cached for good.
  c.header("cache-control", "public, max-age=31536000, immutable");
  return c.body(CSS, 200, { "content-type": "text/css; charset=utf-8" });
});
app.get("/icon.svg", (c) => {
  c.header("cache-control", "public, max-age=86400");
  return c.body(ICON, 200, { "content-type": "image/svg+xml" });
});
app.get("/robots.txt", (c) =>
  c.text("User-agent: *\nDisallow: /manage/\nDisallow: /confirm/\nDisallow: /unsubscribe/\nDisallow: /signin/\nDisallow: /account\n"),
);
app.get("/health", (c) => c.json({ ok: true }));

// ── Reading ─────────────────────────────────────────────────────────────

async function renderEdition(c: Context<App>, date: string | null) {
  const edition = date ? await editionByDate(c.env.DB, date) : await latestEdition(c.env.DB);
  if (!edition) return date ? c.notFound() : page(c, <EmptyPage />);
  const stories = await storiesFor(c.env.DB, edition.date);
  const sources = await sourcesFor(c.env.DB, stories);
  return page(c, <EditionPage edition={edition} stories={stories} sources={sources} isToday={!date || edition.date === utcDate(Date.now())} />);
}

app.get("/", (c) => renderEdition(c, null));
app.get("/e/:date", (c) => renderEdition(c, c.req.param("date")));

app.get("/s/:id", async (c) => {
  const story = await storyById(c.env.DB, c.req.param("id"));
  if (!story) return c.notFound();
  const edition = await editionByDate(c.env.DB, story.editionDate);
  if (!edition) return c.notFound();
  const sources = await sourcesFor(c.env.DB, [story]);
  const viewer = c.get("viewer");
  const [briefing, connected] = await Promise.all([loadBriefing(c.env.DB, story.id), viewer ? connectedProvider(c.env.DB, viewer.id) : null]);
  return page(c, <StoryPage story={story} sources={sources} edition={edition} briefing={briefing} connected={connected} reported={c.req.query("reported") === "1"} />);
});

app.post("/s/:id/report", async (c) => {
  const story = await storyById(c.env.DB, c.req.param("id"));
  if (!story) return c.notFound();
  const form = await c.req.parseBody();
  // Bots fill every field; people never see this one.
  if (form.website) return c.redirect(`/s/${story.id}?reported=1#report`, 303);
  const body = parseReport(form.body);
  if (!body) return page(c, <MessagePage title="Report not sent"><p>Write between {REPORT_MIN} and {REPORT_MAX} characters. <a href={`/s/${story.id}#report`}>Back to the story</a>.</p></MessagePage>, 400);
  const { success } = await c.env.SIGNUP_LIMIT.limit({ key: c.req.header("cf-connecting-ip") ?? "unknown" });
  if (!success) return page(c, <MessagePage title="Slow down"><p>Too many requests from here. Try again in a minute.</p></MessagePage>, 429);
  await saveReport(c.env.DB, story.id, body, Date.now());
  return c.redirect(`/s/${story.id}?reported=1#report`, 303);
});

app.post("/s/:id/briefing", async (c) => {
  const viewer = c.get("viewer");
  if (!viewer) return c.redirect("/signin", 303);
  const story = await storyById(c.env.DB, c.req.param("id"));
  if (!story) return c.notFound();
  if (!(await connectedProvider(c.env.DB, viewer.id))) return c.redirect("/account#ai", 303);
  await requestBriefing(c.env, story.id, viewer.id);
  return c.redirect(`/s/${story.id}#briefing`, 303);
});

app.get("/archive", async (c) => page(c, <ArchivePage editions={await listEditions(c.env.DB)} />));

// What the morning email looks like, from today's edition, so readers can see it before signing up.
app.get("/sample-email", async (c) => {
  const edition = await latestEdition(c.env.DB);
  if (!edition) return c.redirect("/", 303);
  const stories = await storiesFor(c.env.DB, edition.date);
  const sources = await sourcesFor(c.env.DB, stories.filter((s) => s.front));
  const photos = new Map(
    stories.flatMap((s) => {
      const src = s.imageItemId ? sources.get(s.imageItemId) : undefined;
      return src?.imageUrl ? [[s.id, { url: src.imageUrl, credit: src.outlet.name }] as const] : [];
    }),
  );
  const firstReads = new Map(stories.filter((s) => s.front).flatMap((s) => {
    const src = readFirst(s, sources);
    return src ? [[s.id, src] as const] : [];
  }));
  const mail = digestEmail(edition, digestFor(stories, []), c.env.APP_URL, `${c.env.APP_URL}/#subscribe`, photos, firstReads);
  c.header("cache-control", "private, no-cache");
  return c.html(mail.html);
});
app.get("/method", (c) => page(c, <MethodPage />));

// ── Email out ───────────────────────────────────────────────────────────

const CheckInbox = () => (
  <MessagePage title="Check your inbox">
    <p>If that address can get Tare, we've sent it a link. It can take a minute to arrive; check spam if you don't see it.</p>
  </MessagePage>
);

const BadLink = () => (
  <MessagePage title="That link didn't work">
    <p>It may have expired or been cut off. Open it straight from the email, or <a href="/signin">get a new sign-in link</a>.</p>
  </MessagePage>
);

/**
 * Sends the email a form post earned (confirm, manage or sign-in link). On failure it hands the cooldown
 * back so the reader can retry at once, and renders an error page instead of throwing.
 */
async function sendFor(c: Context<App>, outcome: EmailOutcome) {
  if (!outcome.send) return null;
  const { apiKey, linkSecret } = requireSecrets(c.env);
  const base = c.env.APP_URL;
  const mail =
    outcome.send === "confirm" ? confirmEmail(`${base}/confirm/${await signExpiring(linkSecret, "confirm", outcome.id)}`)
    : outcome.send === "signin" ? signinEmail(`${base}/signin/${await signExpiring(linkSecret, "signin", outcome.id)}`)
    : manageEmail(`${base}/manage/${await signLink(linkSecret, "manage", outcome.id)}`);
  try {
    await sendOne(apiKey, { from: c.env.MAIL_FROM, to: outcome.email, ...mail });
    return null;
  } catch (err) {
    console.error(`mail failed: ${err instanceof Error ? err.message : String(err)}`);
    await releaseEmailClaim(c.env.DB, outcome.id, outcome.previous, outcome.claimedAt);
    return page(c, <MessagePage title="That didn't send"><p>We couldn't send the email just now. Try again in a moment.</p></MessagePage>, 502);
  }
}

/** Shared gate for forms that send email: honeypot, address check, per-IP rate limit. */
async function emailFormGate(c: Context<App>, form: Record<string, unknown>, onBadEmail: () => Response | Promise<Response>) {
  // Bots fill every field; people never see this one.
  if (form.website) return { stop: page(c, <CheckInbox />) };
  const email = parseEmail(form.email);
  if (!email) return { stop: await onBadEmail() };
  const { success } = await c.env.SIGNUP_LIMIT.limit({ key: c.req.header("cf-connecting-ip") ?? "unknown" });
  if (!success) return { stop: page(c, <MessagePage title="Slow down"><p>Too many requests from here. Try again in a minute.</p></MessagePage>, 429) };
  return { email };
}

app.post("/subscribe", async (c) => {
  const form = await c.req.parseBody({ all: true });
  const gate = await emailFormGate(c, form, () =>
    page(c, <Layout title="Subscribe · Tare" nav="subscribe"><SubscribeForm error="That doesn't look like an email address." /></Layout>, 400),
  );
  if (gate.stop) return gate.stop;

  const failed = await sendFor(c, await signUp(c.env.DB, gate.email, formTopics(form.topics)));
  return failed ?? page(c, <CheckInbox />);
});

// ── Accounts (email-only, no passwords) ─────────────────────────────────

async function startSession(c: Context<App>, id: string) {
  setSessionCookie(c, await createSession(c.env.DB, id));
}

app.get("/signin", (c) => (c.get("viewer") ? c.redirect("/account", 303) : page(c, <SignInPage />)));

app.post("/signin", async (c) => {
  const form = await c.req.parseBody();
  const gate = await emailFormGate(c, form, () => page(c, <SignInPage error="That doesn't look like an email address." />, 400));
  if (gate.stop) return gate.stop;

  const failed = await sendFor(c, await requestSignin(c.env.DB, gate.email));
  return failed ?? page(c, <CheckInbox />);
});

// Emailed links only show a button; the POST acts. Mail scanners open links, but they don't press buttons.
const ConfirmButton = ({ title, action, label, children }: { title: string; action: string; label: string; children?: Child }) => (
  <MessagePage title={title}>
    {children}
    <form method="post" action={action}><div class="actions"><button class="primary" type="submit">{label}</button></div></form>
  </MessagePage>
);

app.get("/signin/:token", async (c) => {
  const id = await verifyExpiring(requireSecrets(c.env).linkSecret, "signin", c.req.param("token"));
  const sub = id ? await findById(c.env.DB, id) : null;
  if (!sub) return page(c, <BadLink />, 404);
  return page(c, <ConfirmButton title="Sign in to Tare" action={`/signin/${c.req.param("token")}`} label="Sign in"><p>Signing in as {sub.email}.</p></ConfirmButton>);
});

app.post("/signin/:token", async (c) => {
  const id = await verifyExpiring(requireSecrets(c.env).linkSecret, "signin", c.req.param("token"));
  const sub = id ? await verifyEmail(c.env.DB, id) : null;
  if (!sub) return page(c, <BadLink />, 404);
  await startSession(c, sub.id);
  return c.redirect("/account", 303);
});

app.post("/signout", async (c) => {
  await endSession(c.env.DB, sessionToken(c));
  clearSessionCookie(c);
  return c.redirect("/", 303);
});

const requireViewer = (c: Context<App>) => c.get("viewer");

app.get("/account", async (c) => {
  const viewer = requireViewer(c);
  if (!viewer) return c.redirect("/signin", 303);
  const saved = {
    topics: "Topics saved.", on: "Daily email turned on.", off: "Daily email turned off.",
    ai: "Connected. You can ask for a detailed briefing on any story.", "ai-off": "Disconnected.",
  }[c.req.query("saved") ?? ""];
  return page(c, <AccountPage saved={saved} aiProvider={await connectedProvider(c.env.DB, viewer.id)} />);
});

// ── Connecting a reader's own Grok or ChatGPT (for detailed briefings) ──

const PKCE_COOKIE = "tare_ai_pkce";
type Pkce = { verifier: string; state: string; provider: AiProvider; url: string };

function readPkce(c: Context<App>): Pkce | null {
  try {
    const p = JSON.parse(getCookie(c, PKCE_COOKIE) ?? "null");
    return p && typeof p.verifier === "string" && typeof p.state === "string" && isProvider(p.provider) && typeof p.url === "string" ? p : null;
  } catch {
    return null;
  }
}

app.post("/account/ai/start", async (c) => {
  if (!requireViewer(c)) return c.redirect("/signin", 303);
  const provider = (await c.req.parseBody()).provider;
  const chosen: AiProvider = isProvider(provider) ? provider : "grok";
  const { verifier, state, url } = startSignIn(chosen);
  setCookie(c, PKCE_COOKIE, JSON.stringify({ verifier, state, provider: chosen, url }), {
    httpOnly: true, sameSite: "Lax", secure: new URL(c.req.url).protocol === "https:", path: "/account/ai", maxAge: 15 * 60,
  });
  return page(c, <Layout title="Connect · Tare" nav="account"><AiPaste provider={chosen} authorizeUrl={url} /></Layout>);
});

app.post("/account/ai/complete", async (c) => {
  const viewer = requireViewer(c);
  if (!viewer) return c.redirect("/signin", 303);
  const pkce = readPkce(c);
  if (!pkce) return c.redirect("/account?expired=1#ai", 303);
  const retry = (error: string) => page(c, <Layout title="Connect · Tare" nav="account"><AiPaste provider={pkce.provider} authorizeUrl={pkce.url} error={error} /></Layout>, 400);
  const name = PROVIDER_LABEL[pkce.provider];
  const pasted = String((await c.req.parseBody()).callback ?? "").trim().slice(0, 4000);
  const { code, state, error } = readCallback(pasted);
  if (error) return retry(`${name} sign-in was cancelled or failed. Open the sign-in again.`);
  if (!code) return retry(`That doesn't contain a sign-in code. Copy the full code or address ${name} showed you.`);
  // A bare code (no state) belongs to the one pending attempt in this browser.
  if (state && state !== pkce.state) return retry("That code is from a different sign-in attempt. Open the sign-in link above again.");
  if (!c.env.AI_TOKEN_KEY) throw new Error("AI_TOKEN_KEY is not set.");
  try {
    await saveConnection(c.env.DB, c.env.AI_TOKEN_KEY, viewer.id, await exchange(code, pkce.verifier, pkce.provider));
  } catch (err) {
    console.error(`${pkce.provider} token exchange failed: ${err instanceof Error ? err.message : String(err)}`);
    return retry(`${name} didn't accept that code. Codes expire quickly, so open the sign-in again.`);
  }
  deleteCookie(c, PKCE_COOKIE, { path: "/account/ai" });
  return c.redirect("/account?saved=ai#ai", 303);
});

app.post("/account/ai/disconnect", async (c) => {
  const viewer = requireViewer(c);
  if (!viewer) return c.redirect("/signin", 303);
  await deleteConnection(c.env.DB, viewer.id);
  return c.redirect("/account?saved=ai-off#ai", 303);
});

app.post("/account/topics", async (c) => {
  const viewer = requireViewer(c);
  if (!viewer) return c.redirect("/signin", 303);
  await setTopics(c.env.DB, viewer.id, formTopics((await c.req.parseBody({ all: true })).topics));
  return c.redirect("/account?saved=topics", 303);
});

app.post("/account/email", async (c) => {
  const viewer = requireViewer(c);
  if (!viewer) return c.redirect("/signin", 303);
  const on = (await c.req.parseBody()).on === "1";
  await setDigest(c.env.DB, viewer.id, on);
  return c.redirect(`/account?saved=${on ? "on" : "off"}`, 303);
});

app.post("/account/delete", async (c) => {
  const viewer = requireViewer(c);
  if (!viewer) return c.redirect("/signin", 303);
  await deleteAccount(c.env.DB, viewer.id);
  clearSessionCookie(c);
  c.set("viewer", null);
  return page(c, <MessagePage title="Account deleted"><p>Your email address and topics are gone from Tare. The site stays free to read.</p></MessagePage>);
});

// ── Links from emails (work without signing in) ─────────────────────────

async function subscriberFor(c: Context<App>) {
  const id = await verifyLink(requireSecrets(c.env).linkSecret, "manage", c.req.param("token") ?? "");
  return id ? findById(c.env.DB, id) : null;
}

const confirmTarget = (c: Context<App>) => verifyExpiring(requireSecrets(c.env).linkSecret, "confirm", c.req.param("token") ?? "");

app.get("/confirm/:token", async (c) => {
  const id = await confirmTarget(c);
  const sub = id ? await findById(c.env.DB, id) : null;
  if (!sub) return page(c, <BadLink />, 404);
  return page(
    c,
    <ConfirmButton title="Confirm your subscription" action={`/confirm/${c.req.param("token")}`} label="Confirm subscription">
      <p>Tare will email the daily edition to {sub.email}.</p>
    </ConfirmButton>,
  );
});

app.post("/confirm/:token", async (c) => {
  const id = await confirmTarget(c);
  const sub = id ? await confirm(c.env.DB, id) : null;
  if (!sub) return page(c, <BadLink />, 404);
  // Confirming proves the address, so it signs the reader in too.
  await startSession(c, sub.id);
  c.set("viewer", sub);
  return page(
    c,
    <MessagePage title="You're subscribed">
      <p>The next edition arrives tomorrow morning, by 7 a.m. Eastern. You're signed in, so you can change your topics any time.</p>
      <div class="actions"><a class="btn primary" href="/">Read today's edition</a><a class="btn" href="/account">Your account</a></div>
    </MessagePage>,
  );
});

app.get("/manage/:token", async (c) => {
  const sub = await subscriberFor(c);
  if (!sub) return page(c, <BadLink />, 404);
  return page(c, <ManagePage token={c.req.param("token")} email={sub.email} topics={sub.topics} status={sub.status} />);
});

app.post("/manage/:token", async (c) => {
  const sub = await subscriberFor(c);
  if (!sub) return page(c, <BadLink />, 404);
  const topics = formTopics((await c.req.parseBody({ all: true })).topics);
  await setTopics(c.env.DB, sub.id, topics);
  return page(c, <ManagePage token={c.req.param("token")} email={sub.email} topics={topics} status={sub.status} saved />);
});

// GET only asks, so link scanners in mail clients can't unsubscribe anyone. POST does it (including RFC 8058 one-click).
app.get("/unsubscribe/:token", async (c) => {
  const sub = await subscriberFor(c);
  if (!sub) return page(c, <BadLink />, 404);
  return page(c, <UnsubscribeConfirmPage token={c.req.param("token")} />);
});

app.post("/unsubscribe/:token", async (c) => {
  const sub = await subscriberFor(c);
  if (!sub) return page(c, <BadLink />, 404);
  await unsubscribe(c.env.DB, sub.id);
  return page(
    c,
    <MessagePage title="You're unsubscribed">
      <p>You won't get any more emails. Your account stays, so you can still sign in and read every edition.</p>
    </MessagePage>,
  );
});

// ── Operations ──────────────────────────────────────────────────────────

// Readers' error reports, newest first: GET /admin/reports with the admin token.
app.get("/admin/reports", async (c) => {
  c.header("cache-control", "no-store");
  const token = c.env.ADMIN_TOKEN;
  const given = (c.req.header("authorization") ?? "").replace(/^Bearer /, "");
  if (!token || !timingSafeEqual(given, token)) return c.json({ error: "unauthorized" }, 401);
  return c.json(await recentReports(c.env.DB));
});

// Model comparison: POST /admin/debug/rewrite?story=<id>&model=<workers ai model> with the admin token. Nothing is saved.
app.post("/admin/debug/rewrite", async (c) => {
  c.header("cache-control", "no-store");
  const token = c.env.ADMIN_TOKEN;
  const given = (c.req.header("authorization") ?? "").replace(/^Bearer /, "");
  if (!token || !timingSafeEqual(given, token)) return c.json({ error: "unauthorized" }, 401);
  const story = c.req.query("story") ?? "";
  const model = c.req.query("model") ?? "";
  if (!/^@cf\/[\w.\/-]+$/.test(model)) return c.json({ error: "bad model" }, 400);
  const result = await rewriteSample(c.env, story, model);
  return result ? c.json(result) : c.json({ error: "no such story" }, 404);
});

// Manual runs: POST /admin/run/build?force=1 with the admin token.
app.post("/admin/run/:job", async (c) => {
  c.header("cache-control", "no-store");
  const token = c.env.ADMIN_TOKEN;
  const given = (c.req.header("authorization") ?? "").replace(/^Bearer /, "");
  if (!token || !timingSafeEqual(given, token)) return c.json({ error: "unauthorized" }, 401);
  const job = c.req.param("job") as JobName;
  if (!(job in JOBS)) return c.json({ error: "unknown job" }, 404);
  const result = job === "build" ? await JOBS.build(c.env, c.req.query("force") === "1") : await JOBS[job](c.env);
  return c.json({ job, result });
});

app.notFound((c) => page(c, <MessagePage title="Not in this edition"><p><a href="/">Back to today's edition</a>.</p></MessagePage>, 404));

app.onError((err, c) => {
  console.error(`unhandled: ${err.message}`);
  return page(c, <MessagePage title="Something went wrong"><p>Try again in a moment.</p></MessagePage>, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runCron(controller.cron, env));
  },
  async queue(batch, env) {
    for (const msg of batch.messages) {
      await runBriefing(env, msg.body);
      msg.ack();
    }
  },
} satisfies ExportedHandler<Env, BriefingJob>;

export { app };
