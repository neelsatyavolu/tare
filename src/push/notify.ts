import { latestEdition, storiesFor, type Story } from "../editions";
import type { Env } from "../env";
import { SLOT_NAME } from "../slots";
import { apnsConfig, pushAll, type PushReport } from "./apns";
import { devicesDue, devicesForBreaking, markPushed } from "./devices";

/** A story counts as breaking only this soon after Tare first saw it, so a rebuild can't push old news. */
const BREAKING_WINDOW_MS = 2 * 3600_000;
/** Enough outlets that the story is established, not a single early report. */
const BREAKING_MIN_OUTLETS = 5;

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

/** The story to push as breaking news this hour, if any: new, most important, on the front page, widely covered. */
export function breakingStory(stories: readonly Story[], alreadyPushed: ReadonlySet<string>, now: number): Story | null {
  const fresh = stories.filter(
    (s) => s.front && (s.importance ?? 0) >= 5 && s.coverage.total >= BREAKING_MIN_OUTLETS && s.firstSeenAt !== null &&
      now - s.firstSeenAt <= BREAKING_WINDOW_MS && !alreadyPushed.has(s.id),
  );
  return fresh.sort((a, b) => (b.firstSeenAt ?? 0) - (a.firstSeenAt ?? 0))[0] ?? null;
}

/** After a build: pushes at most one breaking story, and remembers it so it goes out once. */
export async function notifyBreaking(env: Env, fetcher: typeof fetch = fetch, now = Date.now()): Promise<PushReport | null> {
  const edition = await latestEdition(env.DB);
  if (!edition) return null;
  const stories = await storiesFor(env.DB, edition.date);
  const ids = stories.map((s) => s.id);
  if (ids.length === 0) return null;
  const { results } = await env.DB.prepare(`SELECT story_id FROM pushed_stories WHERE story_id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ story_id: string }>();
  const story = breakingStory(stories, new Set(results.map((r) => r.story_id)), now);
  if (!story) return null;
  await env.DB.prepare("INSERT OR IGNORE INTO pushed_stories (story_id, pushed_at) VALUES (?, ?)").bind(story.id, now).run();
  return pushAll(env.DB, apnsConfig(env), await devicesForBreaking(env.DB), {
    title: "Breaking",
    body: story.headline,
    storyId: story.id,
    thread: "breaking",
    ttl: 2 * 3600,
  }, fetcher, now);
}
