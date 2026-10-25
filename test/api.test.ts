import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/index";
import { utcDate } from "../src/util";

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
