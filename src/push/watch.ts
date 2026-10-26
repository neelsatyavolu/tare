import { SAME_EVENT, sections, windowItems, type Member } from "../build/build";
import { clusterItems, dot, normalize } from "../build/cluster";
import { matchStories } from "../build/match";
import { frontEligible, rankGroups, type Candidate } from "../build/select";
import type { AiRunner } from "../build/summarize";
import { utcDate } from "../util";
import { BREAKING_MIN_IMPORTANCE, BREAKING_MIN_OUTLETS, BREAKING_WINDOW_MS, establishedAt } from "./notify";

/** `groups` events in the last 2 hours; `fresh` just established and not yet in the edition; `major` of those rated 4 or 5 and able to make the front page (alerts go only to front-page stories). */
export type WatchReport = { groups: number; fresh: number; major: number };

/** A recent group with the earlier headlines about the same event, so its established time counts them. */
function withEarlier(group: Candidate<Member>, earlier: readonly Member[]): Candidate<Member> {
  const dims = group.members[0]!.vec.length;
  const centroid = normalize(group.members.reduce((acc, m) => acc.map((x, k) => x + m.vec[k]!), new Array<number>(dims).fill(0)));
  return rankGroups([[...earlier.filter((m) => dot(m.vec, centroid) >= SAME_EVENT), ...group.members]])[0]!;
}

/**
 * Between hourly builds: has major news broken since? Answered without rebuilding the edition. Only the last
 * 2 hours of headlines are grouped (the build groups the whole day), from stored embeddings, no model; earlier
 * headlines are compared only with the groups several outlets are reporting. A group just established, and that
 * the edition doesn't have yet, is rated by the cheap classifier; its rating is remembered on the items, so the
 * next build doesn't ask again.
 */
export async function watchBreaking(db: D1Database, ai: AiRunner, now: number, stopAt: number): Promise<WatchReport> {
  const { members } = await windowItems(db, ai, now);
  const isRecent = (m: Member) => now - m.publishedAt <= BREAKING_WINDOW_MS;
  const groups = rankGroups(clusterItems(members.filter(isRecent), SAME_EVENT));
  const earlier = members.filter((m) => !isRecent(m));
  const recent = groups
    .filter((g) => g.coverage.total >= BREAKING_MIN_OUTLETS)
    .map((g) => withEarlier(g, earlier))
    .filter((g) => now - (establishedAt(g.members) ?? 0) <= BREAKING_WINDOW_MS);
  if (recent.length === 0) return { groups: groups.length, fresh: 0, major: 0 };

  const { results } = await db.prepare("SELECT item_ids FROM stories WHERE edition_date = ?").bind(utcDate(now)).all<{ item_ids: string }>();
  const inEdition = matchStories(recent.map((g) => g.members.map((m) => m.id)), results.map((r) => JSON.parse(r.item_ids) as string[]));
  const fresh = recent.filter((_, i) => inEdition[i] === -1);
  if (fresh.length === 0) return { groups: groups.length, fresh: 0, major: 0 };

  const ratings = await sections(db, ai, fresh, stopAt);
  const major = fresh.filter((g, i) => (ratings[i]!.importance ?? 0) >= BREAKING_MIN_IMPORTANCE && frontEligible({ ...g, importance: ratings[i]!.importance }));
  return { groups: groups.length, fresh: fresh.length, major: major.length };
}
