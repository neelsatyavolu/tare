import { eventGroups, sections } from "../build/build";
import { matchStories } from "../build/match";
import { frontEligible } from "../build/select";
import type { AiRunner } from "../build/summarize";
import { utcDate } from "../util";
import { BREAKING_MIN_IMPORTANCE, BREAKING_MIN_OUTLETS, BREAKING_WINDOW_MS, establishedAt } from "./notify";

/** `groups` events in the window; `fresh` just established and not yet in the edition; `major` of those rated 4 or 5 and able to make the front page (alerts go only to front-page stories). */
export type WatchReport = { groups: number; fresh: number; major: number };

/**
 * Between hourly builds: has major news broken since? Answered without rebuilding the edition. Grouping the
 * headlines uses their stored embeddings, no model; only a group several outlets have just started reporting,
 * and that the edition doesn't have yet, is rated by the cheap classifier. Its rating is remembered on the
 * items, so the next build doesn't ask again.
 */
export async function watchBreaking(db: D1Database, ai: AiRunner, now: number, stopAt: number): Promise<WatchReport> {
  const { groups } = await eventGroups(db, ai, now);
  const recent = groups.filter((g) => g.coverage.total >= BREAKING_MIN_OUTLETS && now - (establishedAt(g.members) ?? 0) <= BREAKING_WINDOW_MS);
  if (recent.length === 0) return { groups: groups.length, fresh: 0, major: 0 };

  const { results } = await db.prepare("SELECT item_ids FROM stories WHERE edition_date = ?").bind(utcDate(now)).all<{ item_ids: string }>();
  const inEdition = matchStories(recent.map((g) => g.members.map((m) => m.id)), results.map((r) => JSON.parse(r.item_ids) as string[]));
  const fresh = recent.filter((_, i) => inEdition[i] === -1);
  if (fresh.length === 0) return { groups: groups.length, fresh: 0, major: 0 };

  const ratings = await sections(db, ai, fresh, stopAt);
  const major = fresh.filter((g, i) => (ratings[i]!.importance ?? 0) >= BREAKING_MIN_IMPORTANCE && frontEligible({ ...g, importance: ratings[i]!.importance }));
  return { groups: groups.length, fresh: fresh.length, major: major.length };
}
