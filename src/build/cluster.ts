export type Embedded = { id: string; outletId: string; publishedAt: number; vec: number[] };

export function normalize(v: number[]): number[] {
  const len = Math.hypot(...v);
  return len === 0 ? v : v.map((x) => x / len);
}

/** Dot product; equals cosine similarity when both vectors are normalized. */
export function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

type Group<T extends Embedded> = { members: T[]; sum: number[]; centroid: number[] };

function grow<T extends Embedded>(g: Group<T>, item: T): Group<T> {
  const sum = g.sum.map((x, i) => x + item.vec[i]!);
  return { members: [...g.members, item], sum, centroid: normalize(sum) };
}

function merge<T extends Embedded>(a: Group<T>, b: Group<T>): Group<T> {
  const sum = a.sum.map((x, i) => x + b.sum[i]!);
  return { members: [...a.members, ...b.members], sum, centroid: normalize(sum) };
}

/**
 * Groups headlines about the same event. Items join the closest group whose centroid is within
 * `threshold` cosine similarity, oldest first; a second pass merges groups that ended up close.
 * Vectors must already be normalized.
 */
export function clusterItems<T extends Embedded>(items: readonly T[], threshold: number): T[][] {
  const sorted = [...items].sort((a, b) => a.publishedAt - b.publishedAt);
  let groups: Group<T>[] = [];
  for (const item of sorted) {
    let best = -1;
    let bestSim = threshold;
    groups.forEach((g, i) => {
      const sim = dot(g.centroid, item.vec);
      if (sim >= bestSim) {
        best = i;
        bestSim = sim;
      }
    });
    groups = best < 0
      ? [...groups, { members: [item], sum: [...item.vec], centroid: item.vec }]
      : groups.map((g, i) => (i === best ? grow(g, item) : g));
  }

  // Merge sweeps until nothing moves; usually one or two.
  for (let changed = true; changed; ) {
    changed = false;
    const swept: Group<T>[] = [];
    for (const g of groups) {
      const k = swept.findIndex((s) => dot(s.centroid, g.centroid) >= threshold);
      if (k < 0) {
        swept.push(g);
      } else {
        swept[k] = merge(swept[k]!, g);
        changed = true;
      }
    }
    groups = swept;
  }
  return groups.map((g) => g.members);
}
