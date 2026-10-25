import { describe, expect, it } from "vitest";
import { clusterItems, dot, normalize, type Embedded } from "../src/build/cluster";

const item = (id: string, vec: number[], publishedAt = 0): Embedded => ({ id, outletId: id, publishedAt, vec: normalize(vec) });

describe("normalize/dot", () => {
  it("gives cosine similarity of normalized vectors", () => {
    expect(dot(normalize([3, 4]), normalize([3, 4]))).toBeCloseTo(1);
    expect(dot(normalize([1, 0]), normalize([0, 1]))).toBeCloseTo(0);
  });

  it("leaves a zero vector alone", () => {
    expect(normalize([0, 0])).toEqual([0, 0]);
  });
});

describe("clusterItems", () => {
  it("groups near-identical vectors and separates distant ones", () => {
    const groups = clusterItems(
      [item("a1", [1, 0.05, 0]), item("b1", [0, 1, 0]), item("a2", [1, 0, 0.05]), item("b2", [0.05, 1, 0]), item("c", [0, 0, 1])],
      0.9,
    );
    const ids = groups.map((g) => g.map((m) => m.id).sort()).sort((x, y) => x[0]!.localeCompare(y[0]!));
    expect(ids).toEqual([["a1", "a2"], ["b1", "b2"], ["c"]]);
  });

  it("returns every item exactly once", () => {
    const items = Array.from({ length: 20 }, (_, i) => item(`i${i}`, [Math.cos(i), Math.sin(i), i % 3]));
    const flat = clusterItems(items, 0.8).flat().map((m) => m.id).sort();
    expect(flat).toEqual(items.map((m) => m.id).sort());
  });

  it("handles an empty list", () => {
    expect(clusterItems([], 0.8)).toEqual([]);
  });
});
