import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/index";
import { signLink } from "../src/links";
import { findById, signUp, confirm } from "../src/subscribers";
import { utcDate } from "../src/util";

const DATE = utcDate(Date.now());
const STORY_ID = "a".repeat(32);

async function seedEdition() {
  const cov = JSON.stringify({ left: 2, center: 1, right: 2, total: 5, balance: 0 });
  await env.DB.batch([
    env.DB.prepare("DELETE FROM stories"),
    env.DB.prepare("DELETE FROM editions"),
    env.DB.prepare("DELETE FROM items"),
    env.DB.prepare("INSERT INTO editions (date, number, status, item_count) VALUES (?, 3, 'ready', 512)").bind(DATE),
    env.DB.prepare("INSERT INTO items (id, outlet_id, url, title, snippet, published_at, fetched_at) VALUES ('i1','vox','https://vox.test/1','Vox headline <script>','',0,0), ('i2','fox','https://fox.test/1','Fox headline','',0,0)"),
    env.DB.prepare("INSERT INTO stories (id, edition_date, rank, front, topic, headline, summary, differences, coverage, blindspot, item_ids) VALUES (?, ?, 0, 1, 'politics', 'Senate passes bill', ?, ?, ?, NULL, '[\"i1\",\"i2\"]')")
      .bind(STORY_ID, DATE, JSON.stringify([{ text: "The Senate passed it.", cites: ["i1", "i2"] }]), JSON.stringify([{ kind: "framing", text: "Vox says X; Fox says Y.", cites: ["i1", "i2"] }]), cov),
  ]);
}

const req = (path: string, init?: RequestInit) => app.request(path, init, env);
const form = (data: Record<string, string | string[]>) => {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) for (const x of [v].flat()) body.append(k, x);
  return { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": crypto.randomUUID() } };
};

let sent: { url: string; body: any }[] = [];
beforeEach(async () => {
  sent = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response('{"id":"x"}');
  });
  await env.DB.exec("DELETE FROM subscribers");
  await seedEdition();
});
afterEach(() => vi.restoreAllMocks());

describe("pages", () => {
  it("renders today's edition with the scale, citations and escaped text", async () => {
    const res = await req("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Senate passes bill");
    expect(html).toContain("Covered by Vox and Fox News");
    expect(html).toContain("Too few left- or right-leaning outlets to compare");
    expect(html).toContain(`href="/s/${STORY_ID}#src-1"`);
    expect(html).toContain("That&#39;s the edition.");
    expect(res.headers.get("content-security-policy")).toContain("script-src 'none'");
  });

  it("renders a story page with its sources grouped by side", async () => {
    const html = await (await req(`/s/${STORY_ID}`)).text();
    expect(html).toContain('id="src-1"');
    expect(html).toContain("Vox headline &lt;script&gt;");
    expect(html).toContain("https://fox.test/1");
    expect(html).toContain("Where accounts differ (1)");
  });

  it("404s unknown stories, bad dates and missing editions", async () => {
    expect((await req("/s/nope")).status).toBe(404);
    expect((await req("/e/2020-01-01")).status).toBe(404);
    expect((await req("/e/not-a-date")).status).toBe(404);
  });

  it("shows a placeholder before the first edition", async () => {
    await env.DB.exec("DELETE FROM editions");
    expect(await (await req("/")).text()).toContain("The first edition is on the press.");
  });

  it("serves the archive, method page, stylesheet and icon", async () => {
    expect(await (await req("/archive")).text()).toContain("No. 3");
    expect(await (await req("/method")).text()).toContain("Washington Free Beacon");
    expect((await req("/styles.css")).headers.get("content-type")).toContain("text/css");
    expect((await req("/icon.svg")).status).toBe(200);
  });
});

describe("subscribe flow", () => {
  it("signs up, emails a confirm link and activates on click", async () => {
    const res = await req("/subscribe", form({ email: "New@Example.com", topics: ["tech", "bogus"] }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Check your inbox");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.to).toEqual(["new@example.com"]);

    const link = String(sent[0]!.body.text).match(/http:\/\/localhost:8787(\/confirm\/\S+)/)![1]!;
    const id = link.split("/")[2]!.split("~")[0]!;
    // Opening the link (as a mail scanner would) only shows a button.
    expect(await (await req(link)).text()).toContain("Confirm subscription");
    expect((await findById(env.DB, id))?.status).toBe("pending");

    const confirmed = await req(link, { method: "POST" });
    expect(await confirmed.text()).toContain("You&#39;re subscribed");
    expect(confirmed.headers.get("set-cookie")).toContain("tare_session=");
    expect(await findById(env.DB, id)).toMatchObject({ status: "active", topics: ["tech"] });
  });

  it("rejects bad addresses and quietly drops honeypot posts", async () => {
    expect((await req("/subscribe", form({ email: "nope" }))).status).toBe(400);
    expect((await req("/subscribe", form({ email: "bot@ex.com", website: "spam" }))).status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it("refuses a forged or wrong-purpose link", async () => {
    const s = await signUp(env.DB, "a@ex.com", [], 0);
    const manage = await signLink(env.LINK_SECRET!, "manage", s.id);
    expect((await req(`/confirm/${manage}`)).status).toBe(404);
    expect((await req(`/manage/${s.id}.forged`)).status).toBe(404);
  });

  it("updates topics and unsubscribes only on POST", async () => {
    const s = await signUp(env.DB, "b@ex.com", ["world"], 0);
    await confirm(env.DB, s.id);
    const token = await signLink(env.LINK_SECRET!, "manage", s.id);

    expect(await (await req(`/manage/${token}`)).text()).toContain("b@ex.com");
    expect(await (await req(`/manage/${token}`, form({ topics: ["science", "climate"] }))).text()).toContain("Saved.");
    expect((await findById(env.DB, s.id))?.topics).toEqual(["science", "climate"]);

    await req(`/unsubscribe/${token}`);
    expect((await findById(env.DB, s.id))?.status).toBe("active");
    await req(`/unsubscribe/${token}`, form({ "List-Unsubscribe": "One-Click" }));
    expect((await findById(env.DB, s.id))?.status).toBe("unsubscribed");
  });
});

describe("admin", () => {
  it("needs the admin token", async () => {
    expect((await req("/admin/run/send", { method: "POST" })).status).toBe(401);
    expect((await req("/admin/run/nope", { method: "POST", headers: { authorization: "Bearer test-admin-token" } })).status).toBe(404);
    const ok = await req("/admin/run/send", { method: "POST", headers: { authorization: "Bearer test-admin-token" } });
    expect(await ok.json()).toMatchObject({ job: "send", result: { status: "sent", sent: 0 } });
  });
});

describe("accounts", () => {
  const cookieFrom = (res: Response) => res.headers.get("set-cookie")!.split(";")[0]!;

  async function signIn(email: string) {
    await req("/signin", form({ email }));
    const link = String(sent.at(-1)!.body.text).match(/http:\/\/localhost:8787(\/signin\/\S+)/)![1]!;
    // The emailed link only shows a button; pressing it signs in.
    expect(await (await req(link)).text()).toContain(`Signing in as ${email}`);
    const res = await req(link, { method: "POST" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account");
    return cookieFrom(res);
  }

  it("signs in by email link, shows the account and personalizes the nav", async () => {
    const cookie = await signIn("reader@ex.com");
    const account = await req("/account", { headers: { cookie } });
    const html = await account.text();
    expect(html).toContain("Signed in as <b>reader@ex.com</b>");
    expect(html).toContain("Turn on the daily email");
    expect(account.headers.get("cache-control")).toBe("private, no-cache");
    expect(await (await req("/", { headers: { cookie } })).text()).toContain('href="/account"');
  });

  it("saves topics, turns the email on, signs out and deletes", async () => {
    const cookie = await signIn("full@ex.com");
    const headers = { cookie, "content-type": "application/x-www-form-urlencoded" };
    await req("/account/topics", { method: "POST", headers, body: "topics=tech&topics=world" });
    await req("/account/email", { method: "POST", headers, body: "on=1" });
    const html = await (await req("/account?saved=on", { headers: { cookie } })).text();
    expect(html).toContain("Daily email turned on.");
    expect(html).toContain("Turn off the daily email");

    await req("/signout", { method: "POST", headers: { cookie } });
    expect((await req("/account", { headers: { cookie } })).headers.get("location")).toBe("/signin");

    const again = await signIn("full@ex.com");
    expect(await (await req("/account/delete", { method: "POST", headers: { cookie: again } })).text()).toContain("Account deleted");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM subscribers WHERE email = 'full@ex.com'").first<{ n: number }>())?.n).toBe(0);
  });

  it("refuses cross-site posts and expired or forged sign-in links", async () => {
    const cookie = await signIn("x@ex.com");
    const res = await req("/account/delete", { method: "POST", headers: { cookie, origin: "https://evil.test" } });
    expect(res.status).toBe(403);
    expect((await req("/signin/abc~1.forged")).status).toBe(404);
  });

  it("shows a signed-in reader their email status instead of the sign-up form", async () => {
    const cookie = await signIn("f@ex.com");
    const html = await (await req("/", { headers: { cookie } })).text();
    expect(html).toContain("Your daily email is off.");
  });
});

describe("sample email", () => {
  it("shows today's edition as the morning email, before anyone signs up", async () => {
    const res = await req("/sample-email");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Senate passes bill");
    expect(html).toContain("That's the edition.");
  });
});
