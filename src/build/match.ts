/** Share of the smaller set's items that two groups have in common for them to be the same story. */
export const SAME_STORY = 0.5;

/**
 * Pairs this hour's story groups with stories already in the edition, so a story that keeps developing
 * keeps its id (and its link) instead of being written up again. Greedy by overlap, one-to-one.
 * Returns, for each candidate, the index of its existing story or -1.
 */
export function matchStories(candidates: readonly (readonly string[])[], existing: readonly (readonly string[])[]): number[] {
  const pairs: { c: number; e: number; overlap: number }[] = [];
  candidates.forEach((cand, c) => {
    const set = new Set(cand);
    existing.forEach((ex, e) => {
      const shared = ex.filter((id) => set.has(id)).length;
      const overlap = shared / Math.max(1, Math.min(set.size, ex.length));
      if (shared > 0 && overlap >= SAME_STORY) pairs.push({ c, e, overlap });
    });
  });
  pairs.sort((a, b) => b.overlap - a.overlap || a.c - b.c || a.e - b.e);

  const result = new Array<number>(candidates.length).fill(-1);
  const taken = new Set<number>();
  for (const p of pairs) {
    if (result[p.c] !== -1 || taken.has(p.e)) continue;
    result[p.c] = p.e;
    taken.add(p.e);
  }
  return result;
}

/** A story is written up again when its coverage has grown a lot since the last write-up. */
export function needsRewrite(writtenTotal: number | null, total: number): boolean {
  if (writtenTotal == null) return true;
  return total >= writtenTotal * 1.5 && total - writtenTotal >= 3;
}
