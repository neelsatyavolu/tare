import { latestEdition, storiesFor, type Story } from "../editions";
import type { Env } from "../env";
import { SLOT_NAME } from "../slots";
import { apnsConfig, pushAll, type PushReport } from "./apns";
import { devicesDue, devicesForBreaking, markPushed } from "./devices";

/**
 * A story counts as breaking only this soon after it was established (see `establishedAt`), so a story outlets
 * have carried for hours isn't pushed when it first reaches the edition, or again when the edition is rebuilt.
 */
export const BREAKING_WINDOW_MS = 2 * 3600_000;
/** Enough outlets that the story is established, not a single early report. */
export const BREAKING_MIN_OUTLETS = 3;
/** Major (4) or historic (5) on Tare's importance scale. */
export const BREAKING_MIN_IMPORTANCE = 4;
/** A busy hour still sends only this many, so a news surge can't flood a phone. */
const BREAKING_PER_BUILD = 3;

/** The hourly edition push: each phone whose local clock is at 7 a.m. or 6 p.m. hears what leads the edition. */
export async function notifyDue(env: Env, fetcher: typeof fetch = fetch, now = Date.now()): Promise<PushReport | null> {
  const groups = await devicesDue(env.DB, now);
  if (groups.length === 0) return null;
  const edition = await latestEdition(env.DB);
  if (!edition) return null;
  const stories = await storiesFor(env.DB, edition.date);
  const lead = stories.find((s) => s.front) ?? stories[0];
  if (!lead) return null;
  const more = stories.length - 1;
  const total: PushReport = { sent: 0, failed: 0, removed: 0 };
  for (const { slot, key, devices } of groups) {
    const report = await pushAll(env.DB, apnsConfig(env), devices, {
      title: `Tare · ${SLOT_NAME[slot]}`,
      body: `${lead.headline}${more > 0 ? `, and ${more} more ${more === 1 ? "story" : "stories"}` : ""}`,
      thread: "edition",
      ttl: 6 * 3600,
    }, fetcher, now);
    await markPushed(env.DB, devices.map((d) => d.token), key);
    total.sent += report.sent;
    total.failed += report.failed;
    total.removed += report.removed;
  }
  return total;
}

/** When a story became established: the first report from its BREAKING_MIN_OUTLETS-th outlet, or null before then. */
export function establishedAt(reports: readonly { outletId: string; publishedAt: number }[]): number | null {
  const first = new Map<string, number>();
  for (const r of reports) first.set(r.outletId, Math.min(r.publishedAt, first.get(r.outletId) ?? Infinity));
  return [...first.values()].sort((a, b) => a - b)[BREAKING_MIN_OUTLETS - 1] ?? null;
}

/**
 * The stories to push as breaking news now: major, on the front page, and established by several outlets within
 * the window (`established` maps story id to `establishedAt`). Most important first.
 */
export function breakingStories(stories: readonly Story[], alreadyPushed: ReadonlySet<string>, established: ReadonlyMap<string, number>, now: number): Story[] {
  const fresh = stories.filter((s) => {
    const at = established.get(s.id);
    return s.front && (s.importance ?? 0) >= BREAKING_MIN_IMPORTANCE && s.coverage.total >= BREAKING_MIN_OUTLETS && at !== undefined &&
      now - at <= BREAKING_WINDOW_MS && !alreadyPushed.has(s.id);
  });
  return fresh
    .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || established.get(b.id)! - established.get(a.id)!)
    .slice(0, BREAKING_PER_BUILD);
}

/** `establishedAt` for each front-page story, from its reports' publication times. */
async function establishedTimes(db: D1Database, stories: readonly Story[]): Promise<Map<string, number>> {
  const front = stories.filter((s) => s.front).map((s) => s.id);
  if (front.length === 0) return new Map();
  const { results } = await db
    .prepare(`SELECT s.id AS story_id, i.outlet_id, i.published_at FROM stories s, json_each(s.item_ids) j JOIN items i ON i.id = j.value
              WHERE s.id IN (${front.map(() => "?").join(",")})`)
    .bind(...front)
    .all<{ story_id: string; outlet_id: string; published_at: number }>();
  return new Map(front.flatMap((id) => {
    const at = establishedAt(results.filter((r) => r.story_id === id).map((r) => ({ outletId: r.outlet_id, publishedAt: r.published_at })));
    return at === null ? [] : [[id, at] as const];
  }));
}

/** After a build: pushes each new breaking story, and remembers them so each goes out once. */
export async function notifyBreaking(env: Env, fetcher: typeof fetch = fetch, now = Date.now()): Promise<PushReport | null> {
  const edition = await latestEdition(env.DB);
  if (!edition) return null;
  const stories = await storiesFor(env.DB, edition.date);
  const ids = stories.map((s) => s.id);
  if (ids.length === 0) return null;
  const { results } = await env.DB.prepare(`SELECT story_id FROM pushed_stories WHERE story_id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ story_id: string }>();
  const breaking = breakingStories(stories, new Set(results.map((r) => r.story_id)), await establishedTimes(env.DB, stories), now);
  if (breaking.length === 0) return null;
  const mark = env.DB.prepare("INSERT OR IGNORE INTO pushed_stories (story_id, pushed_at) VALUES (?, ?)");
  await env.DB.batch(breaking.map((s) => mark.bind(s.id, now)));
  const devices = await devicesForBreaking(env.DB);
  const total: PushReport = { sent: 0, failed: 0, removed: 0 };
  for (const story of breaking) {
    const report = await pushAll(env.DB, apnsConfig(env), devices, {
      title: "Breaking",
      body: story.headline,
      storyId: story.id,
      thread: "breaking",
      ttl: 2 * 3600,
    }, fetcher, now);
    total.sent += report.sent;
    total.failed += report.failed;
    total.removed += report.removed;
  }
  return total;
}
