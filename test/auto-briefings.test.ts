import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTO_PER_BUILD, AUTO_PER_READER_PER_DAY, autoBriefingsOn, queueAutoBriefings, setAutoBriefings } from "../src/auto-briefings";
import { app } from "../src/index";
import { utcDate } from "../src/util";

const NOW = Date.now();
const DATE = utcDate(NOW);
const id = (n: number) => String(n).padStart(32, "0");
const cov = JSON.stringify({ left: 2, center: 1, right: 2, total: 5, balance: 0 });

async function seed(frontStories: number) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM briefings"),
    env.DB.prepare("DELETE FROM ai_connections"),
    env.DB.prepare("DELETE FROM subscribers"),
    env.DB.prepare("DELETE FROM stories"),
    env.DB.prepare("DELETE FROM editions"),
    env.DB.prepare("INSERT INTO editions (date, number, status) VALUES (?, 1, 'ready')").bind(DATE),
    ...Array.from({ length: frontStories + 1 }, (_, i) =>
      env.DB.prepare("INSERT INTO stories (id, edition_date, rank, front, topic, headline, summary, differences, coverage, item_ids) VALUES (?, ?, ?, ?, 'world', ?, '[]', '[]', ?, '[]')")
        .bind(id(i), DATE, i, i < frontStories ? 1 : 0, `Story ${i}`, cov),
    ),
  ]);
}

async function reader(name: string, auto: boolean) {
  const subId = name.padEnd(32, "x");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO subscribers (id, email, topics, status, created_at) VALUES (?, ?, '[]', 'unsubscribed', 0)").bind(subId, `${name}@example.com`),
    env.DB.prepare("INSERT INTO ai_connections (subscriber_id, provider, sealed, updated_at, auto_briefings) VALUES (?, 'grok', 'sealed', 0, ?)").bind(subId, auto ? 1 : 0),
  ]);
  return subId;
}

describe("automatic briefings", () => {
  let queued: { storyId: string; subscriberId: string }[] = [];
  beforeEach(() => {
    queued = [];
    vi.spyOn(env.BRIEFING_QUEUE, "send").mockImplementation((async (body: never) => void queued.push(body)) as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it("does nothing until a reader opts in", async () => {
    await seed(5);
    await reader("off", false);
    expect(await queueAutoBriefings(env, NOW)).toEqual({ queued: 0 });
  });

  it("queues the top front-page stories without a briefing, spread across opted-in readers", async () => {
    await seed(5);
    const a = await reader("a", true);
    const b = await reader("b", true);
    expect(await queueAutoBriefings(env, NOW)).toEqual({ queued: AUTO_PER_BUILD });
    expect(queued.map((q) => q.storyId)).toEqual([id(0), id(1), id(2)]);
    expect(new Set(queued.map((q) => q.subscriberId))).toEqual(new Set([a, b]));
    // The next build picks up where this one stopped; inside-page stories are never auto-written.
    queued = [];
    await queueAutoBriefings(env, NOW + 1);
    expect(queued.map((q) => q.storyId)).toEqual([id(3), id(4)]);
    queued = [];
    expect(await queueAutoBriefings(env, NOW + 2)).toEqual({ queued: 0 });
  });

  it("stops at the daily allowance and pauses a reader whose last one failed", async () => {
    await seed(AUTO_PER_READER_PER_DAY + 3);
    const a = await reader("a", true);
    for (let i = 0; i < 5; i++) await queueAutoBriefings(env, NOW + i);
    expect(queued).toHaveLength(AUTO_PER_READER_PER_DAY);

    await seed(2);
    await reader("a", true);
    await env.DB.prepare("INSERT INTO briefings (story_id, status, requested_by, requested_at, auto) VALUES (?, 'failed', ?, ?, 1)").bind(id(99), a, NOW).run();
    queued = [];
    expect(await queueAutoBriefings(env, NOW + 10)).toEqual({ queued: 0 });
  });

  it("is a setting on the connection, off by default, and reported by the app API", async () => {
    await seed(1);
    const a = await reader("a", false);
    expect(await autoBriefingsOn(env.DB, a)).toBe(false);
    await setAutoBriefings(env.DB, a, true);
    expect(await autoBriefingsOn(env.DB, a)).toBe(true);
    expect((await app.request("/api/v1/me/auto-briefings", { method: "POST", body: '{"on":true}' }, env)).status).toBe(401);
  });
});
