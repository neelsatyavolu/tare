import { outletById, sideOf, SIDE_SIZE, OUTLETS, type Side } from "../outlets";
import { TOPIC_IDS, type TopicId } from "../topics";

export type Coverage = { left: number; center: number; right: number; unrated: number; total: number; balance: number };
export type Blindspot = "left" | "right" | null;

/** A story needs this many distinct outlets to be considered at all. */
export const MIN_OUTLETS = 3;
/** |balance| at or past this reads as "mostly covered by one side". */
export const LEAN_THRESHOLD = 0.5;

/**
 * Distinct outlets per side, plus a balance from -1 (only the left covered it) to 1 (only the right).
 * Unrated outlets count toward the total but toward no side.
 */
export function coverageOf(outletIds: readonly string[]): Coverage {
  const counts: Record<Side, number> = { left: 0, center: 0, right: 0 };
  let unrated = 0;
  for (const id of new Set(outletIds)) {
    const o = outletById(id);
    if (!o) continue;
    const side = sideOf(o.lean);
    if (side) counts[side] += 1;
    else unrated += 1;
  }
  // Shares, not counts, so a side with more outlets in the list can't tip the scale.
  const ls = counts.left / SIDE_SIZE.left;
  const rs = counts.right / SIDE_SIZE.right;
  const balance = ls + rs === 0 ? 0 : (rs - ls) / (rs + ls);
  return { ...counts, unrated, total: counts.left + counts.center + counts.right + unrated, balance: Math.round(balance * 100) / 100 };
}

/**
 * When a story counts as a blindspot. One or two missing outlets is noise, so it takes real evidence:
 * enough coverage overall, at least 3 outlets and 7% of one side (a share, so the rule holds as the source
 * list grows; most outlets publish only a few stories a day, so higher shares missed clear cases), and at
 * most one outlet from the other side. The build then checks every headline the other side published.
 */
export const BLINDSPOT = { minTotal: 6, minShare: 0.07, minCount: 3, maxOther: 1 } as const;

const covered = (count: number, size: number) => count >= BLINDSPOT.minCount && count / size >= BLINDSPOT.minShare;

/** The side that skipped a story the other side covered widely, if any. The build then double-checks it (see build.ts). */
export function blindspotOf(c: Coverage): Blindspot {
  if (c.total < BLINDSPOT.minTotal) return null;
  if (covered(c.right, SIDE_SIZE.right) && c.left <= BLINDSPOT.maxOther) return "left";
  if (covered(c.left, SIDE_SIZE.left) && c.right <= BLINDSPOT.maxOther) return "right";
  return null;
}

export type LeanReading = {
  key: "thin" | "even" | "center-led" | "more-left" | "more-right" | "no-left" | "no-right" | "only-left" | "only-right";
  sentence: string;
  tag: string;
};

/**
 * What the coverage scale says, in words a reader can check against the counts. It names a side only when
 * that side had at least 3 outlets and at least twice as many as the other (in shares too), and it says
 * plainly when there's too little to compare. It describes coverage, never the story.
 */
/** With this many rated outlets on the other side and the center, a side's silence is labeled even if the counts are small. */
const ZERO_SIDE_MIN = 6;

export function leanReading(c: Coverage): LeanReading {
  const thin: LeanReading = { key: "thin", sentence: "Too few left- or right-leaning outlets to compare", tag: "Too few to compare" };
  // One side at zero while the other side and the center carried it is worth saying even with few on that side.
  if (c.right === 0 && c.left > 0 && c.left + c.center >= ZERO_SIDE_MIN) return { key: "no-right", sentence: "No right-leaning outlets in Tare's list covered it", tag: "No right-leaning coverage" };
  if (c.left === 0 && c.right > 0 && c.right + c.center >= ZERO_SIDE_MIN) return { key: "no-left", sentence: "No left-leaning outlets in Tare's list covered it", tag: "No left-leaning coverage" };
  if (c.left < 3 && c.right < 3) return thin;
  // With no center coverage either, it's one side's story rather than something the other side skipped.
  if (c.right >= 3 && c.left === 0 && c.center === 0) return { key: "only-right", sentence: "Only right-leaning outlets in Tare's list covered it", tag: "Right-leaning outlets only" };
  if (c.left >= 3 && c.right === 0 && c.center === 0) return { key: "only-left", sentence: "Only left-leaning outlets in Tare's list covered it", tag: "Left-leaning outlets only" };
  if (c.right >= 3 && c.left === 0) return { key: "no-left", sentence: "No left-leaning outlets in Tare's list covered it", tag: "No left-leaning coverage" };
  if (c.left >= 3 && c.right === 0) return { key: "no-right", sentence: "No right-leaning outlets in Tare's list covered it", tag: "No right-leaning coverage" };
  const ls = c.left / SIDE_SIZE.left;
  const rs = c.right / SIDE_SIZE.right;
  // When center outlets covered it more than either side, that's the honest headline about its coverage.
  if (c.center > c.left && c.center > c.right && c.left > 0 && c.right > 0) {
    return { key: "center-led", sentence: `Center outlets covered it most (C ${c.center} · L ${c.left} · R ${c.right})`, tag: "More center coverage" };
  }
  if (c.right >= 3 && c.right >= 2 * c.left && rs >= 2 * ls) return { key: "more-right", sentence: "More right- than left-leaning coverage", tag: "More right-leaning coverage" };
  if (c.left >= 3 && c.left >= 2 * c.right && ls >= 2 * rs) return { key: "more-left", sentence: "More left- than right-leaning coverage", tag: "More left-leaning coverage" };
  // "Similar" needs a real sample on both sides; otherwise there's too little to say.
  if (c.left >= 3 && c.right >= 3) return { key: "even", sentence: "Similar left and right coverage", tag: "Similar left and right" };
  return thin;
}

/** Plain-English reason a story made the edition. Deterministic, so readers can check it. */
export function whyText(c: Coverage, blindspot: Blindspot): string {
  const unrated = c.unrated ? `, ${c.unrated} not rated` : "";
  const base = `Covered by ${c.total} outlets: ${c.left} left, ${c.center} center, ${c.right} right${unrated}.`;
  if (blindspot === "left") return `${base} A possible blindspot: ${c.left} of ${SIDE_SIZE.left} left-leaning outlets covered it, and Tare found no matching headline from the others in the last 24 hours.`;
  if (blindspot === "right") return `${base} A possible blindspot: ${c.right} of ${SIDE_SIZE.right} right-leaning outlets covered it, and Tare found no matching headline from the others in the last 24 hours.`;
  return base;
}

export type Candidate<T> = { members: T[]; coverage: Coverage; blindspot: Blindspot; latest: number };

/** A section's top story may have this few outlets, so quieter sections (science, sports) still appear. */
export const SECTION_MIN_OUTLETS = 2;

/** Every group with at least SECTION_MIN_OUTLETS outlets, most widely covered first (newest first on ties). */
export function rankGroups<T extends { outletId: string; publishedAt: number }>(groups: readonly T[][]): Candidate<T>[] {
  return groups
    .map((members) => {
      const coverage = coverageOf(members.map((m) => m.outletId));
      return { members, coverage, blindspot: blindspotOf(coverage), latest: Math.max(...members.map((m) => m.publishedAt)) };
    })
    .filter((c) => c.coverage.total >= SECTION_MIN_OUTLETS)
    .sort((a, b) => b.coverage.total - a.coverage.total || b.latest - a.latest);
}

export type BalanceOptions = { front: number; perSection: number; blindspots: number; max: number };
export const BALANCE: BalanceOptions = { front: 6, perSection: 3, blindspots: 3, max: 30 };

/**
 * Which groups get written up. Fixed rules, no personalization and no engagement signals:
 * 1. the front page: the most widely covered stories that both the left and the right reported;
 * 2. every section: its most widely covered stories (3+ outlets), up to `perSection`, or failing that its
 *    single best story with 2 outlets, so politics can't crowd out science or sports;
 * 3. blindspots: widely covered stories one side mostly skipped.
 * `ranked` must come from rankGroups (best first); the result keeps that order.
 */
export function pickBalanced<C extends Candidate<unknown> & { topic: TopicId | null; importance: number | null }>(all: readonly C[], opts: BalanceOptions = BALANCE): C[] {
  const chosen = new Set<C>();
  // Puzzle hints, gossip and viral posts (importance 1) don't make any part of the edition.
  const ranked = all.filter((c) => c.importance !== 1);
  const wide = ranked.filter((c) => c.coverage.total >= MIN_OUTLETS);

  frontPage(wide, opts.front).forEach((c) => chosen.add(c));

  for (const topic of TOPIC_IDS) {
    const inSection = ranked.filter((c) => c.topic === topic && !chosen.has(c)).sort(sectionOrder);
    // Only stories with enough coverage; a section with nothing that clears the bar is left out.
    inSection.filter((c) => c.coverage.total >= MIN_OUTLETS).slice(0, opts.perSection).forEach((c) => chosen.add(c));
  }

  wide
    .filter((c) => c.blindspot && !chosen.has(c) && (c.importance ?? 0) >= MIN_IMPORTANCE)
    .sort(byWeight)
    .slice(0, opts.blindspots)
    .forEach((c) => chosen.add(c));

  return ranked.filter((c) => chosen.has(c)).slice(0, opts.max);
}

/** Front-page stories and blindspots must be at least this important (see IMPORTANCE_RUBRIC). */
export const MIN_IMPORTANCE = 3;

type Weighed = { coverage: Coverage; importance: number | null };

/** Most important first, then most widely covered. An unrated group counts as minor (2), so it can't jump the queue. */
export const byWeight = (a: Weighed, b: Weighed) => (b.importance ?? 2) - (a.importance ?? 2) || b.coverage.total - a.coverage.total;

/** A front-page story needs this many outlets: fewer is too thin to lead an edition. */
export const FRONT_MIN_OUTLETS = 6;
/** At this importance a story can lead even if one side skipped it; it shows as a possible blindspot. */
export const LEAD_ANYWAY_IMPORTANCE = 4;

/** The most consequential stories (importance 5: deadly attacks, elections, wars) need only this many outlets. */
export const FRONT_MIN_OUTLETS_MAJOR = 3;

/** A story this widely covered, by both sides, is front-page news even if rated minor. */
export const FRONT_BY_BREADTH = 15;

const frontEligible = (s: Weighed & { blindspot?: Blindspot }) => {
  const importance = s.importance ?? 0;
  if (importance >= 2 && s.coverage.total >= FRONT_BY_BREADTH && s.coverage.left > 0 && s.coverage.right > 0) return true;
  const minOutlets = importance >= 5 ? FRONT_MIN_OUTLETS_MAJOR : FRONT_MIN_OUTLETS;
  if (s.coverage.total < minOutlets || importance < MIN_IMPORTANCE) return false;
  return (s.coverage.left > 0 && s.coverage.right > 0) || (importance >= LEAD_ANYWAY_IMPORTANCE && !!s.blindspot);
};

/**
 * Front page: the most important stories with at least FRONT_MIN_OUTLETS outlets that both the left and the
 * right reported, plus very important ones one side skipped; widest first on ties.
 */
export function frontPage<T extends Weighed & { blindspot?: Blindspot }>(stories: readonly T[], size: number): Set<T> {
  const eligible = [...stories].filter(frontEligible).sort(frontOrder);
  const top = eligible.slice(0, size);
  // A story most of the press covered keeps a front slot (up to FRONT_EXTRA more), unless it's rated minor.
  const wide = eligible.slice(size).filter((s) => s.coverage.total >= FRONT_BY_BREADTH && (s.importance ?? 0) >= MIN_IMPORTANCE);
  return new Set([...top, ...wide.slice(0, FRONT_EXTRA)]);
}

/** How many extra front slots very widely covered stories can take beyond the front page's size. */
export const FRONT_EXTRA = 2;

/**
 * Front-page score: importance, plus a bonus for breadth that is capped at 1.5, so consequence leads and
 * wide coverage breaks ties without letting attention outrank a more important story by more than a step.
 */
export const frontScore = (s: Weighed) => (s.importance ?? 2) + Math.min(1.5, Math.log2(Math.max(1, s.coverage.total)) / 3);
export const frontOrder = (a: Weighed, b: Weighed) => frontScore(b) - frontScore(a) || b.coverage.total - a.coverage.total;

/** Section order: the same consequence-first score as the front page, so a wide but minor story can't lead a section. */
export const sectionOrder = frontOrder;
