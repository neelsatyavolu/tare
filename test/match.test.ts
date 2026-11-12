import { describe, expect, it } from "vitest";
import { matchStories, needsRewrite } from "../src/build/match";

describe("matchStories", () => {
  it("pairs each group with the existing story it mostly overlaps, one to one", () => {
    const existing = [["a", "b", "c"], ["x", "y"]];
    expect(matchStories([["a", "b", "z"], ["y", "x", "w"], ["q"]], existing)).toEqual([0, 1, -1]);
  });

  it("keeps a big story's own write-up when a small story it swallowed overlaps it more by share", () => {
    const ids = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}${i}`);
    // The big story's group kept 57 of its 100 items; a 10-item story was swallowed whole by the same group.
    const group = [...ids("big", 57), ...ids("small", 10), ...ids("new", 35)];
    expect(matchStories([group], [ids("small", 10), ids("big", 100)])).toEqual([1]);
  });

  it("needs half of the smaller set in common", () => {
    expect(matchStories([["a", "z", "w", "v"]], [["a", "b", "c"]])).toEqual([-1]);
    expect(matchStories([["a", "b"]], [["a", "b", "c", "d", "e"]])).toEqual([0]);
  });

  it("gives a contested story to the closer group", () => {
    expect(matchStories([["a", "b", "x", "y"], ["a", "b", "c"]], [["a", "b", "c"]])).toEqual([-1, 0]);
  });
});

describe("needsRewrite", () => {
  it("rewrites when there is no write-up or coverage doubled with at least three more outlets", () => {
    expect(needsRewrite(null, 3)).toBe(true);
    expect(needsRewrite(6, 12)).toBe(true);
    expect(needsRewrite(6, 11)).toBe(false);
    expect(needsRewrite(6, 9)).toBe(false);
    expect(needsRewrite(2, 4)).toBe(false);
  });
});
