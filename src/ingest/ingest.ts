import { OUTLETS, type Outlet } from "../outlets";
import { sha256Hex } from "../util";
import { parseFeed, type FeedItem } from "./rss";

const FEED_TIMEOUT_MS = 15_000;
/** A Worker keeps six connections open and queues the rest, so firing every fetch at once would start each
 * feed's timeout while it waits in that queue. Six lanes keep the timeout on the fetch itself. */
const FEED_CONCURRENCY = 6;
/** Feeds not started by then are skipped, so a run of slow feeds can't eat the build's time (about 30 s is normal). */
const INGEST_BUDGET_MS = 3 * 60_000;
const MAX_AGE_MS = 48 * 3600_000;
const KEEP_MS = 3 * 24 * 3600_000;
/** Bigger than any real feed (the largest seen is about 1.1 MB); protects memory from a broken one. */
const MAX_FEED_BYTES = 5_000_000;
const MAX_TITLE = 300;
const MAX_URL = 2_000;
const USER_AGENT = "TareBot/0.1 (+https://tare.news/method; headlines and links only)";

export type IngestReport = { feeds: number; failed: string[]; inserted: number };

async function fetchFeed(url: string, fetcher: typeof fetch, now: number): Promise<FeedItem[]> {
  const res = await fetcher(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5" },
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_FEED_BYTES) throw new Error(`feed too large (${declared} bytes)`);
  const body = await res.text();
  if (body.length > MAX_FEED_BYTES) throw new Error(`feed too large (${body.length} chars)`);
  return parseFeed(body, now);
}

/** Like Promise.allSettled over `list`, with at most `limit` calls in flight; an item not started by `deadline` is rejected. */
async function settleLimited<T, R>(list: readonly T[], limit: number, deadline: number, fn: (x: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(list.length);
  let next = 0;
  const lane = async () => {
    for (let i = next++; i < list.length; i = next++) {
      try {
        if (Date.now() > deadline) throw new Error("skipped: ingest time budget used up");
        out[i] = { status: "fulfilled", value: await fn(list[i]!) };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, lane));
  return out;
}

/** Pulls every outlet's feeds and stores new headlines. A failing feed is logged and skipped, never fatal. */
export async function ingest(db: D1Database, fetcher: typeof fetch = fetch, now = Date.now(), outlets: readonly Outlet[] = OUTLETS): Promise<IngestReport> {
  const jobs = outlets.flatMap((o) => o.feeds.map((url) => ({ outlet: o, url })));
  // The budget runs on the real clock; `now` dates the items and can be fixed in tests.
  const results = await settleLimited(jobs, FEED_CONCURRENCY, Date.now() + INGEST_BUDGET_MS, (j) => fetchFeed(j.url, fetcher, now));

  const failed: string[] = [];
  const rows: { id: string; outletId: string; item: FeedItem }[] = [];
  for (const [i, r] of results.entries()) {
    const job = jobs[i]!;
    if (r.status === "rejected") {
      failed.push(job.url);
      console.warn(`feed failed: ${job.url}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
      continue;
    }
    for (const item of r.value) {
      // Future dates are clock skew or scheduled posts; clamp them so they can't pin a story to the top.
      const fixed = { ...item, title: item.title.slice(0, MAX_TITLE), publishedAt: Math.min(item.publishedAt, now) };
      if (item.url.length > MAX_URL || now - fixed.publishedAt > MAX_AGE_MS) continue;
      // Keyed by outlet too: two outlets linking the same URL are two pieces of coverage.
      rows.push({ id: await sha256Hex(`${job.outlet.id}|${item.url}`), outletId: job.outlet.id, item: fixed });
    }
  }

  const insert = db.prepare(
    "INSERT OR IGNORE INTO items (id, outlet_id, url, title, snippet, published_at, fetched_at, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  let inserted = 0;
  // D1 batches are transactions; keep them modest, and don't let one bad batch lose the rest.
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    try {
      const out = await db.batch(chunk.map((r) => insert.bind(r.id, r.outletId, r.item.url, r.item.title, r.item.snippet, r.item.publishedAt, now, r.item.imageUrl && r.item.imageUrl.length <= MAX_URL ? r.item.imageUrl : null)));
      inserted += out.reduce((n, o) => n + (o.meta.changes ?? 0), 0);
    } catch (err) {
      console.error(`item batch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Headlines a story cites stay forever so archived editions keep their sources.
  await db
    .prepare("DELETE FROM items WHERE published_at < ? AND id NOT IN (SELECT j.value FROM stories, json_each(stories.item_ids) AS j)")
    .bind(now - KEEP_MS)
    .run();

  return { feeds: jobs.length, failed, inserted };
}
