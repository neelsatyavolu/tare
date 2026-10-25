import { describe, expect, it } from "vitest";
import { blindspotOf, coverageOf, frontPage, pickBalanced, rankGroups, whyText } from "../src/build/select";
import { TOPIC_IDS, type TopicId } from "../src/topics";
import { OUTLETS, SIDE_SIZE } from "../src/outlets";

describe("source list", () => {
  it("has the same number of outlets on the left and the right", () => {
    expect(SIDE_SIZE.left).toBe(SIDE_SIZE.right);
    expect(new Set(OUTLETS.map((o) => o.id)).size).toBe(OUTLETS.length);
  });
});

describe("coverageOf", () => {
  it("counts distinct outlets per side", () => {
    expect(coverageOf(["guardian", "guardian", "nyt", "bbc", "fox"])).toEqual({ left: 2, center: 1, right: 1, total: 4, balance: -0.33 });
  });

  it("is balanced when both sides cover equally and ignores unknown outlets", () => {
    expect(coverageOf(["vox", "fox", "mystery"]).balance).toBe(0);
    expect(coverageOf(["vox", "fox", "mystery"]).total).toBe(2);
  });

  it("reads 1 when only the right covered it and 0 when only the center did", () => {
    expect(coverageOf(["fox", "nypost"]).balance).toBe(1);
    expect(coverageOf(["bbc", "pbs"]).balance).toBe(0);
  });
});

describe("blindspotOf", () => {
  it("flags the side that skipped a widely covered story", () => {
    expect(blindspotOf(coverageOf(["fox", "nypost", "breitbart", "dailywire", "bbc"]))).toBe("left");
    expect(blindspotOf(coverageOf(["vox", "nyt", "npr", "slate", "fox"]))).toBe("right");
  });

  it("does not flag small or balanced stories", () => {
    expect(blindspotOf(coverageOf(["fox", "nypost", "breitbart"]))).toBeNull();
    expect(blindspotOf(coverageOf(["fox", "nypost", "vox", "nyt", "bbc"]))).toBeNull();
  });
});

describe("whyText", () => {
  it("states the counts and the blindspot", () => {
    const c = coverageOf(["fox", "nypost", "breitbart", "dailywire", "bbc"]);
    expect(whyText(c, "left")).toBe(`Covered by 5 of ${OUTLETS.length} outlets: 0 left, 1 center, 4 right. Few left-leaning outlets covered it.`);
  });
});

describe("rankGroups", () => {
  const m = (outletId: string, publishedAt = 0) => ({ outletId, publishedAt });

  it("drops single-outlet groups and ranks by breadth, newest first on ties", () => {
    const ranked = rankGroups([[m("vox")], [m("vox"), m("fox")], [m("vox"), m("bbc"), m("fox")], [m("slate", 9), m("pbs", 9), m("nypost", 9)]]);
    expect(ranked.map((r) => [r.coverage.total, r.latest])).toEqual([[3, 9], [3, 0], [2, 0]]);
  });
});

describe("pickBalanced", () => {
  const outlets = ["vox", "nyt", "npr", "bbc", "pbs", "fox", "nypost", "washtimes", "breitbart", "slate"];
  // A group covered by the first `n` outlets of a mixed list (both sides appear from n = 6).
  const group = (n: number, topic: TopicId | null, one = false) => ({
    ...rankGroups([(one ? ["fox", "nypost", "breitbart", "washtimes", "bbc"] : outlets.slice(0, n)).map((outletId) => ({ outletId, publishedAt: 0 }))])[0]!,
    topic,
  });
  const opts = { front: 2, perSection: 2, blindspots: 1, max: 30 };

  it("gives every section its share instead of letting one topic fill the edition", () => {
    const politics = [10, 9, 9, 8, 8, 7].map((n) => group(n, "politics"));
    const tech = group(3, "tech");
    const sports = group(2, "sports");
    const picked = pickBalanced([...politics, tech, sports], opts);
    // Two front-page stories plus two more politics, then tech's 3-outlet story and sports' best 2-outlet one.
    expect(picked.filter((p) => p.topic === "politics")).toHaveLength(4);
    expect(picked).toContain(tech);
    expect(picked).toContain(sports);
  });

  it("only falls back to a 2-outlet story when a section has nothing wider", () => {
    const strong = group(4, "science");
    const thin = group(2, "science");
    const picked = pickBalanced([strong, thin], { ...opts, front: 0 });
    expect(picked).toEqual([strong]);
  });

  it("adds blindspots and keeps the ranked order", () => {
    const front = group(9, "world");
    const blind = group(5, null, true);
    expect(blind.blindspot).toBe("left");
    const picked = pickBalanced([front, blind], opts);
    expect(picked).toEqual([front, blind]);
  });

  it("caps the total", () => {
    const many = TOPIC_IDS.flatMap((t) => [group(5, t), group(4, t), group(3, t)]);
    expect(pickBalanced(many, { ...opts, max: 7 })).toHaveLength(7);
  });
});

describe("frontPage", () => {
  it("only takes stories both sides covered, widest first", () => {
    const a = { id: "a", coverage: coverageOf(["vox", "fox", "bbc", "pbs"]) };
    const b = { id: "b", coverage: coverageOf(["fox", "nypost", "breitbart", "dailywire", "bbc"]) };
    const c = { id: "c", coverage: coverageOf(["vox", "fox", "bbc"]) };
    expect([...frontPage([c, b, a], 5)].map((s) => s.id)).toEqual(["a", "c"]);
  });
});
