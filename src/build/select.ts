import { outletById, sideOf, SIDE_SIZE, OUTLETS, type Side } from "../outlets";
import { TOPIC_IDS, type TopicId } from "../topics";

export type Coverage = { left: number; center: number; right: number; total: number; balance: number };
export type Blindspot = "left" | "right" | null;

/** A story needs this many distinct outlets to be considered at all. */
export const MIN_OUTLETS = 3;
/** |balance| at or past this reads as "mostly covered by one side". */
export const LEAN_THRESHOLD = 0.5;

/** Distinct outlets per side, plus a balance from -1 (only the left covered it) to 1 (only the right). */
export function coverageOf(outletIds: readonly string[]): Coverage {
  const counts: Record<Side, number> = { left: 0, center: 0, right: 0 };
  for (const id of new Set(outletIds)) {
    const o = outletById(id);
    if (o) counts[sideOf(o.lean)] += 1;
  }
  // Shares, not counts, so a side with more outlets in the list can't tip the scale.
  const ls = counts.left / SIDE_SIZE.left;
  const rs = counts.right / SIDE_SIZE.right;
  const balance = ls + rs === 0 ? 0 : (rs - ls) / (rs + ls);
  return { ...counts, total: counts.left + counts.center + counts.right, balance: Math.round(balance * 100) / 100 };
}

/** The side that mostly skipped a story others covered widely, if any. */
export function blindspotOf(c: Coverage): Blindspot {
  if (c.total < MIN_OUTLETS + 1) return null;
  if (c.balance >= LEAN_THRESHOLD && c.left <= 1) return "left";
  if (c.balance <= -LEAN_THRESHOLD && c.right <= 1) return "right";
  return null;
}

/** Plain-English reason a story made the edition. Deterministic, so readers can check it. */
export function whyText(c: Coverage, blindspot: Blindspot): string {
  const base = `Covered by ${c.total} of ${OUTLETS.length} outlets: ${c.left} left, ${c.center} center, ${c.right} right.`;
  if (blindspot === "left") return `${base} Few left-leaning outlets covered it.`;
  if (blindspot === "right") return `${base} Few right-leaning outlets covered it.`;
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
export function pickBalanced<C extends Candidate<unknown> & { topic: TopicId | null }>(ranked: readonly C[], opts: BalanceOptions = BALANCE): C[] {
  const chosen = new Set<C>();
  const wide = ranked.filter((c) => c.coverage.total >= MIN_OUTLETS);

  wide.filter((c) => c.coverage.left > 0 && c.coverage.right > 0).slice(0, opts.front).forEach((c) => chosen.add(c));

  for (const topic of TOPIC_IDS) {
    const inSection = ranked.filter((c) => c.topic === topic && !chosen.has(c));
    const strong = inSection.filter((c) => c.coverage.total >= MIN_OUTLETS).slice(0, opts.perSection);
    const alreadyShown = [...chosen].some((c) => c.topic === topic);
    (strong.length > 0 || alreadyShown ? strong : inSection.slice(0, 1)).forEach((c) => chosen.add(c));
  }

  wide.filter((c) => c.blindspot && !chosen.has(c)).slice(0, opts.blindspots).forEach((c) => chosen.add(c));

  return ranked.filter((c) => chosen.has(c)).slice(0, opts.max);
}

/** Front page: the most widely covered stories that outlets on both the left and the right reported. */
export function frontPage<T extends { coverage: Coverage }>(stories: readonly T[], size: number): Set<T> {
  return new Set(
    [...stories]
      .filter((s) => s.coverage.left > 0 && s.coverage.right > 0)
      .sort((a, b) => b.coverage.total - a.coverage.total)
      .slice(0, size),
  );
}
