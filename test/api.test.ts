import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/index";
import { utcDate } from "../src/util";
import { bucketOf } from "../src/distribution";
import { outletById } from "../src/outlets";

const DATE = utcDate(Date.now());
const LEAD = "a".repeat(32);
const OTHER = "b".repeat(32);
const req = (path: string, init?: RequestInit) => app.request(path, init, env);
const json = (body: unknown, method = "POST") => ({ method, body: JSON.stringify(body), headers: { "content-type": "application/json", "cf-connecting-ip": crypto.randomUUID() } });

beforeEach(async () => {
  const cov = JSON.stringify({ left: 2, center: 1, right: 2, total: 5, balance: 0 });
  await env.DB.batch([
    env.DB.prepare("DELETE FROM stories"),
    env.DB.prepare("DELETE FROM editions"),
    env.DB.prepare("DELETE FROM items"),
    env.DB.prepare("DELETE FROM devices"),
    env.DB.prepare("INSERT INTO editions (date, number, status, item_count, built_at) VALUES (?, 3, 'ready', 512, ?)").bind(DATE, Date.now()),
    env.DB.prepare("INSERT INTO items (id, outlet_id, url, title, snippet, published_at, fetched_at) VALUES ('i1','vox','https://vox.test/1','Vox headline','Vox says more.',0,0), ('i2','fox','https://fox.test/1','Fox headline','',0,0)"),
    env.DB.prepare("INSERT INTO stories (id, edition_date, rank, front, topic, headline, summary, differences, coverage, blindspot, item_ids) VALUES (?, ?, 0, 1, 'politics', 'Senate passes bill', ?, ?, ?, NULL, '[\"i1\",\"i2\"]')")
      .bind(LEAD, DATE, JSON.stringify([{ text: "The Senate passed it.", cites: ["i1", "i2"] }]), JSON.stringify([{ kind: "framing", text: "Vox says X; Fox says Y.", cites: ["i1", "i2"] }]), cov),
    env.DB.prepare("INSERT INTO stories (id, edition_date, rank, front, topic, headline, summary, differences, coverage, blindspot, item_ids) VALUES (?, ?, 1, 0, 'sports', 'Team wins', ?, '[]', ?, NULL, '[\"i1\",\"i2\"]')")
      .bind(OTHER, DATE, JSON.stringify([{ text: "The team won.", cites: ["i1"] }]), cov),
  ]);
});

describe("/api/v1", () => {
  it("serves today's edition laid out like the site", async () => {
    const res = await req("/api/v1/edition");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.isToday).toBe(true);
    expect(body.sections.map((s: any) => s.id)).toEqual(["front", "sports"]);
    expect(body.sections[0].storyIds).toEqual([LEAD]);
    const lead = body.stories.find((s: any) => s.id === LEAD);
    expect(lead.summary[0]).toEqual({ text: "The Senate passed it.", cites: [1, 2] });
    expect(lead.coverage.reading.key).toBeTruthy();
    expect(lead.differences[0].label).toBe("Framing");
  });

  it("serves a story with its sources and the quotes behind each difference", async () => {
    const body = (await (await req(`/api/v1/stories/${LEAD}`)).json()) as any;
    expect(body.sources.map((s: any) => s.outlet)).toEqual(["Vox", "Fox News"]);
    expect(body.sources[0]).toMatchObject({ n: 1, side: "left", url: "https://vox.test/1", snippet: "Vox says more." });
    expect(body.differences[0].quotes).toHaveLength(2);
    expect((await req(`/api/v1/stories/${"c".repeat(32)}`)).status).toBe(404);
  });

  it("gives each source its score and bucket, and each story its five-bucket distribution", async () => {
    const body = (await (await req(`/api/v1/stories/${LEAD}`)).json()) as any;
    const vox = outletById("vox")!;
    const fox = outletById("fox")!;
    expect(body.sources[0]).toMatchObject({ outlet: "Vox", zeta: vox.zeta, bucket: bucketOf(vox.lean) });
    expect(body.sources[1]).toMatchObject({ outlet: "Fox News", zeta: fox.zeta, bucket: bucketOf(fox.lean) });
    const d = body.distribution;
    expect(Object.keys(d).sort()).toEqual(["center", "leanLeft", "leanRight", "left", "right", "total", "unrated"]);
    expect(d.total).toBe(2);
    expect(d[bucketOf(vox.lean)!]).toBeGreaterThanOrEqual(1);
    expect(d.left + d.leanLeft + d.center + d.leanRight + d.right + d.unrated).toBe(d.total);
    // Existing fields stay as they were.
    expect(body.sources[0]).toMatchObject({ lean: vox.lean, side: "left" });
    const edition = (await (await req("/api/v1/edition")).json()) as any;
    expect(edition.stories.every((s: any) => s.distribution.total === 2)).toBe(true);
  });

  it("gives each story its subtopic and name, null when it has none", async () => {
    await env.DB.prepare("UPDATE stories SET subtopic = 'nba' WHERE id = ?").bind(OTHER).run();
    const body = (await (await req("/api/v1/edition")).json()) as any;
    const other = body.stories.find((s: any) => s.id === OTHER);
    expect(other).toMatchObject({ topic: "sports", topicName: "Sports", subtopic: "nba", subtopicName: "NBA" });
    expect(body.stories.find((s: any) => s.id === LEAD)).toMatchObject({ topic: "politics", subtopic: null, subtopicName: null });
  });

  it("lists every section with its subtopics", async () => {
    const res = await req("/api/v1/topics");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const ids = body.sections.map((s: any) => s.id);
    expect(ids).toContain("ai");
    const sports = body.sections.find((s: any) => s.id === "sports");
    expect(sports.subtopics).toContainEqual({ id: "f1", name: "Formula 1" });
    expect(body.sections.find((s: any) => s.id === "ai").subtopics.map((s: any) => s.id)).toEqual(["ai-models", "ai-policy", "ai-business"]);
  });

  it("registers, updates and removes a device", async () => {
    const token = "ab".repeat(32);
    expect((await req("/api/v1/devices", json({ token, editions: "evening", breaking: false }))).status).toBe(200);
    expect((await req("/api/v1/devices", json({ token, editions: "both", breaking: true, environment: "sandbox" }))).status).toBe(200);
    const row = await env.DB.prepare("SELECT editions, breaking, environment FROM devices WHERE token = ?").bind(token).first();
    expect(row).toEqual({ editions: "both", breaking: 1, environment: "sandbox" });
    expect((await req("/api/v1/devices", json({ token: "not-a-token" }))).status).toBe(400);
    await req(`/api/v1/devices/${token}`, { method: "DELETE" });
    expect(await env.DB.prepare("SELECT token FROM devices").first()).toBeNull();
  });
});

describe("/api/v1 sign-in and briefings", () => {
  let mails: any[] = [];
  beforeEach(async () => {
    mails = [];
    await env.DB.batch([env.DB.prepare("DELETE FROM subscribers"), env.DB.prepare("DELETE FROM signin_codes"), env.DB.prepare("DELETE FROM briefings")]);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      mails.push(JSON.parse(String(init?.body)));
      return new Response('{"id":"m1"}', { status: 200 });
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const signIn = async (email: string) => {
    expect((await req("/api/v1/signin", json({ email }))).status).toBe(200);
    return String(mails.at(-1).text).match(/code is (\d{6})/)![1]!;
  };

  it("signs in with an emailed code, once, and the token reads the account", async () => {
    const code = await signIn("reader@example.com");
    const wrong = await req("/api/v1/signin/verify", json({ email: "reader@example.com", code: code === "000000" ? "111111" : "000000" }));
    expect(wrong.status).toBe(400);
    const ok = await req("/api/v1/signin/verify", json({ email: "Reader@Example.com", code }));
    expect(ok.status).toBe(200);
    const { token } = (await ok.json()) as { token: string };
    // A code works once.
    expect((await req("/api/v1/signin/verify", json({ email: "reader@example.com", code }))).status).toBe(400);

    const me = await req("/api/v1/me", { headers: { authorization: `Bearer ${token}` } });
    expect(await me.json()).toEqual({ email: "reader@example.com", ai: null });
    // Without an AI account connected, asking for a briefing points to the site.
    const ask = await req(`/api/v1/stories/${LEAD}/briefing`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    expect(ask.status).toBe(409);

    await req("/api/v1/signout", { method: "POST", headers: { authorization: `Bearer ${token}` } });
    expect((await req("/api/v1/me", { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
  });

  it("burns a code after five wrong tries", async () => {
    const code = await signIn("guess@example.com");
    for (let i = 0; i < 5; i++) await req("/api/v1/signin/verify", json({ email: "guess@example.com", code: String((Number(code) + 1 + i) % 1_000_000).padStart(6, "0") }));
    expect((await req("/api/v1/signin/verify", json({ email: "guess@example.com", code }))).status).toBe(400);
  });

  it("deletes the signed-in account", async () => {
    const code = await signIn("leaving@example.com");
    const { token } = (await (await req("/api/v1/signin/verify", json({ email: "leaving@example.com", code }))).json()) as { token: string };
    expect((await req("/api/v1/me", { method: "DELETE" })).status).toBe(401);
    expect((await req("/api/v1/me", { method: "DELETE", headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await req("/api/v1/me", { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
    expect(await env.DB.prepare("SELECT id FROM subscribers WHERE email = 'leaving@example.com'").first()).toBeNull();
  });

  it("signs App Review's demo account in with its fixed code, without email", async () => {
    const reviewEnv = { ...env, REVIEW_EMAIL: "review@tare.news", REVIEW_CODE: "246810" };
    const reviewReq = (path: string, init?: RequestInit) => app.request(path, init, reviewEnv);
    expect((await reviewReq("/api/v1/signin", json({ email: "review@tare.news" }))).status).toBe(200);
    expect(mails).toHaveLength(0);
    expect((await reviewReq("/api/v1/signin/verify", json({ email: "review@tare.news", code: "000000" }))).status).toBe(400);
    const ok = await reviewReq("/api/v1/signin/verify", json({ email: "Review@tare.news", code: "246810" }));
    expect(ok.status).toBe(200);
    // The fixed code only works for the review address.
    await reviewReq("/api/v1/signin", json({ email: "other@example.com" }));
    expect((await reviewReq("/api/v1/signin/verify", json({ email: "other@example.com", code: "246810" }))).status).toBe(400);
  });

  it("needs a session to ask for a briefing, and reports none yet", async () => {
    expect((await req(`/api/v1/stories/${LEAD}/briefing`, { method: "POST" })).status).toBe(401);
    expect(await (await req(`/api/v1/stories/${LEAD}/briefing`)).json()).toEqual({ status: "none" });
  });
});
