import { latestEdition, storiesFor, type Story } from "../editions";
import type { Env } from "../env";
import { SLOT_NAME, type Slot } from "../slots";
import { apnsConfig, pushAll, type PushReport } from "./apns";
import { devicesForBreaking, devicesForEdition } from "./devices";

/** A story counts as breaking only this soon after Tare first saw it, so a rebuild can't push old news. */
const BREAKING_WINDOW_MS = 2 * 3600_000;
/** Enough outlets that the story is established, not a single early report. */
const BREAKING_MIN_OUTLETS = 5;

/** Morning or evening: tells devices that take this edition what leads it. */
export async function notifyEdition(env: Env, slot: Slot, fetcher: typeof fetch = fetch, now = Date.now()): Promise<PushReport | null> {
  const edition = await latestEdition(env.DB);
  if (!edition) return null;
  const stories = await storiesFor(env.DB, edition.date);
  const lead = stories.find((s) => s.front) ?? stories[0];
  if (!lead) return null;
  const more = stories.length - 1;
  return pushAll(env.DB, apnsConfig(env), await devicesForEdition(env.DB, slot), {
    title: `Tare · ${SLOT_NAME[slot]}`,
    body: `${lead.headline}${more > 0 ? `, and ${more} more ${more === 1 ? "story" : "stories"}` : ""}`,
    thread: "edition",
    ttl: 6 * 3600,
  }, fetcher, now);
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
