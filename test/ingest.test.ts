import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ingest } from "../src/ingest/ingest";
import type { Outlet } from "../src/outlets";

const NOW = Date.parse("2026-10-24T12:00:00Z");
const feed = (items: { title: string; link: string; date: string }[]) =>
  `<rss><channel>${items.map((i) => `<item><title>${i.title}</title><link>${i.link}</link><pubDate>${i.date}</pubDate></item>`).join("")}</channel></rss>`;

const outlets: Outlet[] = [
  { id: "a", name: "A", lean: "left", feeds: ["https://a.test/rss", "https://a.test/world"] },
  { id: "b", name: "B", lean: "right", feeds: ["https://b.test/rss"] },
];

const fakeFetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url === "https://b.test/rss") return new Response("nope", { status: 503 });
  const body = feed([
    { title: "Fresh story", link: "https://a.test/fresh", date: "Sat, 24 Oct 2026 10:00:00 GMT" },
    { title: "Old story", link: "https://a.test/old", date: "Mon, 19 Oct 2026 10:00:00 GMT" },
    { title: "Future story", link: "https://a.test/future", date: "Sun, 25 Oct 2026 10:00:00 GMT" },
  ]);
  return new Response(body);
}) as typeof fetch;

describe("ingest", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM items");
  });

  it("stores recent items once, skips failed feeds and clamps future dates", async () => {
    const report = await ingest(env.DB, fakeFetch, NOW, outlets);
    expect(report.feeds).toBe(3);
    expect(report.failed).toEqual(["https://b.test/rss"]);
    // Both of A's feeds list the same two recent links; they are stored once.
    expect(report.inserted).toBe(2);

    const { results } = await env.DB.prepare("SELECT title, published_at FROM items ORDER BY title").all<{ title: string; published_at: number }>();
    expect(results.map((r) => r.title)).toEqual(["Fresh story", "Future story"]);
    expect(results.find((r) => r.title === "Future story")?.published_at).toBe(NOW);
  });

  it("keeps the same link from two outlets as two pieces of coverage", async () => {
    const shared = (async () => new Response(feed([{ title: "Wire story", link: "https://wire.test/1", date: "Sat, 24 Oct 2026 10:00:00 GMT" }]))) as typeof fetch;
    const two: Outlet[] = [{ id: "a", name: "A", lean: "left", feeds: ["https://a.test/rss"] }, { id: "b", name: "B", lean: "right", feeds: ["https://b.test/rss"] }];
    expect((await ingest(env.DB, shared, NOW, two)).inserted).toBe(2);
  });

  it("is idempotent across runs", async () => {
    await ingest(env.DB, fakeFetch, NOW, outlets);
    const second = await ingest(env.DB, fakeFetch, NOW + 60_000, outlets);
    expect(second.inserted).toBe(0);
  });
});
