import type { Source, Story } from "./editions";
import { OUTLETS, sideOf, type Lean, type Outlet, type Side } from "./outlets";
import { WELL_KNOWN } from "./read-first";

/**
 * Where a story's coverage sits on the five Eady 2025 buckets, for the distribution bar, the source spectrum and
 * the API. The coverage scale (three sides, shares) stays the rule-bearing measure; this only shows the outlets.
 */
export type Bucket = "left" | "leanLeft" | "center" | "leanRight" | "right";
export type Distribution = Record<Bucket, number> & { unrated: number; total: number };

/** Left to right, the order every view draws them in. */
export const BUCKETS: readonly Bucket[] = ["left", "leanLeft", "center", "leanRight", "right"];

/** The bucket an outlet's lean falls in; null when it has no score. Keys match `Distribution`, for the API. */
export function bucketOf(lean: Lean): Bucket | null {
  switch (lean) {
    case "left": return "left";
    case "lean-left": return "leanLeft";
    case "center": return "center";
    case "lean-right": return "leanRight";
    case "right": return "right";
    default: return null;
  }
}

/** The distinct outlets behind a story, in its item order. Items whose outlet left the list are skipped. */
export function storyOutlets(story: Pick<Story, "itemIds">, sources: ReadonlyMap<string, Source>): Outlet[] {
  const seen = new Map<string, Outlet>();
  for (const id of story.itemIds) {
    const o = sources.get(id)?.outlet;
    if (o && !seen.has(o.id)) seen.set(o.id, o);
  }
  return [...seen.values()];
}

export function distributionOf(outlets: readonly Outlet[]): Distribution {
  const empty: Distribution = { left: 0, leanLeft: 0, center: 0, leanRight: 0, right: 0, unrated: 0, total: 0 };
  return outlets.reduce((d, o) => {
    const b = bucketOf(o.lean);
    return { ...d, ...(b ? { [b]: d[b] + 1 } : { unrated: d.unrated + 1 }), total: d.total + 1 };
  }, empty);
}

/** Rated outlets in a distribution: the ones that can be placed left to right. */
export const ratedOf = (d: Distribution) => d.total - d.unrated;

/** The axis half-width for the spectrum: the furthest score in the whole list, rounded up, so every story shares one axis. */
export const ZETA_SPAN = Math.ceil(Math.max(1.5, ...OUTLETS.map((o) => Math.abs(o.zeta ?? 0))) * 10) / 10;

/**
 * Counts in plain words, e.g. "Of the 9 rated outlets that covered it, 5 are left of center (2 of them in the
 * Left group), 3 are center and 1 is right of center. 2 more are not rated." Describes coverage, nothing else.
 */
export function distributionSentence(d: Distribution): string {
  const rated = ratedOf(d);
  const unrated = d.unrated ? ` ${d.unrated} ${d.unrated === 1 ? "more is" : "more are"} not rated.` : "";
  if (rated === 0) return `None of the ${d.total} outlets that covered it has a lean score, so none can be placed left to right.`;
  const is = (n: number) => `${n} ${n === 1 ? "is" : "are"}`;
  const strong = (n: number, side: string) => (n > 0 ? ` (${n} of them in the ${side} group)` : "");
  return `Of the ${rated} rated ${rated === 1 ? "outlet" : "outlets"} that covered it, ${is(d.left + d.leanLeft)} left of center${strong(d.left, "Left")}, ${is(d.center)} center and ${is(d.right + d.leanRight)} right of center${strong(d.right, "Right")}.${unrated}`;
}

/**
 * One headline from each side that covered the story, for reading it across the spectrum: within a side, the
 * source the summary cites most, then the best-known outlet, then the earliest report.
 */
export function acrossSpectrum(story: Pick<Story, "itemIds" | "summary">, sources: ReadonlyMap<string, Source>): Record<Side, Source | null> {
  const list = story.itemIds.map((id) => sources.get(id)).filter((s): s is Source => !!s);
  const cited = (s: Source) => story.summary.filter((x) => x.cites.includes(s.id)).length;
  const fame = (s: Source) => (WELL_KNOWN.indexOf(s.outlet.id) + 1) || WELL_KNOWN.length + 1;
  const pick = (side: Side) =>
    [...list].filter((s) => sideOf(s.outlet.lean) === side).sort((a, b) => cited(b) - cited(a) || fame(a) - fame(b) || a.publishedAt - b.publishedAt)[0] ?? null;
  return { left: pick("left"), center: pick("center"), right: pick("right") };
}
