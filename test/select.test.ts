import { describe, expect, it } from "vitest";
import { BALANCE, BLINDSPOT, blindspotOf, coverageOf, freshness, frontPage, leanReading, pickBalanced, rankGroups, SECTION_CAPS, whyText } from "../src/build/select";
import { TOPIC_IDS, type TopicId } from "../src/topics";
import { leanOf, OUTLETS, sideOf, SIDE_SIZE } from "../src/outlets";

// Outlets by side, read from the data so these tests don't depend on any one outlet's rating.
const bySide = (side: "left" | "center" | "right") => OUTLETS.filter((o) => sideOf(o.lean) === side).map((o) => o.id);
const L = bySide("left");
const C = bySide("center");
const R = bySide("right");
const UNRATED = OUTLETS.filter((o) => o.lean === "unrated").map((o) => o.id);
const enough = (size: number) => Math.max(BLINDSPOT.minCount, Math.ceil(size * BLINDSPOT.minShare));

describe("source list", () => {
  it("rates every outlet from the published data or marks it unrated, with unique ids", () => {
    expect(new Set(OUTLETS.map((o) => o.id)).size).toBe(OUTLETS.length);
    for (const o of OUTLETS) expect(o.lean).toBe(leanOf(o.zeta));
    expect(UNRATED.length).toBeGreaterThan(0);
    expect(SIDE_SIZE.left + SIDE_SIZE.center + SIDE_SIZE.right + UNRATED.length).toBe(OUTLETS.length);
  });

  it("buckets scores at half and one full congressional gap from zero", () => {
    expect([-1.5, -1.0, 0, 0.62, 0.9, 1.3, null].map(leanOf)).toEqual(["left", "lean-left", "center", "center", "lean-right", "right", "unrated"]);
  });
});

describe("coverageOf", () => {
  it("counts distinct outlets per side and unrated ones only toward the total", () => {
    expect(coverageOf([L[0]!, L[0]!, L[1]!, UNRATED[0]!, R[0]!])).toMatchObject({ left: 2, center: 0, right: 1, unrated: 1, total: 4 });
  });

  it("is balanced by shares, not counts, and ignores unknown outlets", () => {
    const c = coverageOf([L[0]!, R[0]!, "mystery"]);
    expect(c.total).toBe(2);
    expect(Math.sign(c.balance)).toBe(Math.sign(SIDE_SIZE.left - SIDE_SIZE.right) || 0);
  });

  it("reads 1 when only the right covered it and 0 when only the center did", () => {
    expect(coverageOf([R[0]!, R[1]!]).balance).toBe(1);
    expect(coverageOf([C[0]!, C[1]!]).balance).toBe(0);
  });
});

describe("blindspotOf", () => {
  it("flags the side that skipped a story enough of the other side covered", () => {
    expect(blindspotOf(coverageOf([...R.slice(0, Math.max(6, enough(SIDE_SIZE.right)))]))).toBe("left");
    expect(blindspotOf(coverageOf([...L.slice(0, Math.max(5, enough(SIDE_SIZE.left))), R[0]!]))).toBe("right");
  });

  it("treats thin or two-sided coverage as noise, not a blindspot", () => {
    // Too few outlets overall, however lopsided.
    expect(blindspotOf(coverageOf(R.slice(0, 5)))).toBeNull();
    // Below the minimum share of the covering side, even with plenty of center outlets.
    expect(blindspotOf(coverageOf([...R.slice(0, enough(SIDE_SIZE.right) - 1), ...C.slice(0, 6)]))).toBeNull();
    // Two outlets from the other side means it did cover it.
    expect(blindspotOf(coverageOf([...R.slice(0, enough(SIDE_SIZE.right)), L[0]!, L[1]!]))).toBeNull();
  });
});

describe("leanReading", () => {
  it("says there's too little to compare when few left or right outlets covered it", () => {
    expect(leanReading(coverageOf([L[0]!, C[0]!, C[1]!, C[2]!, UNRATED[0]!])).key).toBe("thin");
  });

  it("only names a side with 3+ outlets and twice the other side's, in counts and shares", () => {
    // "Similar" needs at least 3 on each side; 2 vs 2 is too little to say anything.
    expect(leanReading(coverageOf([L[0]!, L[1]!, R[0]!, R[1]!])).key).toBe("thin");
    expect(leanReading(coverageOf([L[0]!, L[1]!, L[2]!, R[0]!, R[1]!, R[2]!])).key).toBe("even");
    // 3 right vs 2 left: not twice as many, and too few on the left to call it similar.
    expect(leanReading(coverageOf([L[0]!, L[1]!, R[0]!, R[1]!, R[2]!])).key).toBe("thin");
    // The review's case: 1 left, 3 center, 3 right reads as more right, never "mostly".
    expect(leanReading(coverageOf([L[0]!, C[0]!, C[1]!, C[2]!, R[0]!, R[1]!, R[2]!])).sentence).toBe("More right- than left-leaning coverage");
    expect(leanReading(coverageOf([L[0]!, L[1]!, L[2]!, C[0]!])).sentence).toBe("No right-leaning outlets in Tare's list covered it");
    // With no center coverage either, it's one side's story.
    expect(leanReading(coverageOf([L[0]!, L[1]!, L[2]!])).key).toBe("only-left");
  });

  it("says a side covered none of it when the rest of the press did, even with few on the other side", () => {
    // The Alaska case: L 2 · C 7 · R 0.
    expect(leanReading(coverageOf([L[0]!, L[1]!, ...C.slice(0, 7)])).key).toBe("no-right");
    expect(leanReading(coverageOf([L[0]!, C[0]!, C[1]!])).key).toBe("thin");
  });

  it("says the center led when center outlets outnumber each side", () => {
    // The review's California ballots case: L 3 · C 4 · R 1 is not "more left".
    const r = leanReading(coverageOf([L[0]!, L[1]!, L[2]!, C[0]!, C[1]!, C[2]!, C[3]!, R[0]!]));
    expect(r.key).toBe("center-led");
    expect(r.sentence).toBe("Center outlets covered it most (C 4 · L 3 · R 1)");
  });
});

describe("whyText", () => {
  it("states the counts and the blindspot", () => {
    const c = coverageOf([...R.slice(0, 6), C[0]!, UNRATED[0]!]);
    expect(whyText(c, "left")).toBe(
      `Covered by 8 outlets: 0 left, 1 center, 6 right, 1 not rated. A possible blindspot: 0 of ${SIDE_SIZE.left} left-leaning outlets covered it, and Tare found no matching headline from the others in the last 24 hours.`,
    );
  });
});

describe("rankGroups", () => {
  const m = (outletId: string, publishedAt = 0) => ({ outletId, publishedAt });

  it("drops single-outlet groups and ranks by breadth, newest first on ties", () => {
    const ranked = rankGroups([[m(L[0]!)], [m(L[0]!), m(R[0]!)], [m(L[0]!), m(C[0]!), m(R[0]!)], [m(L[1]!, 9), m(C[1]!, 9), m(R[1]!, 9)]]);
    expect(ranked.map((r) => [r.coverage.total, r.latest])).toEqual([[3, 9], [3, 0], [2, 0]]);
  });
});

describe("pickBalanced", () => {
  // Alternates sides, so any n >= 2 includes both the left and the right.
  const outlets = [L[0], R[0], C[0], L[1], R[1], C[1], L[2], R[2], C[2], L[3]].map((id) => id!);
  // A group covered by the first `n` outlets of the mixed list.
  const group = (n: number, topic: TopicId | null, one = false, importance: number | null = 4) => ({
    ...rankGroups([(one ? R.slice(0, Math.max(6, enough(SIDE_SIZE.right))) : outlets.slice(0, n)).map((outletId) => ({ outletId, publishedAt: 0 }))])[0]!,
    topic,
    importance,
  });
  const opts = { front: 2, perSection: 2, blindspots: 1, max: 30 };

  it("gives every section its share instead of letting one topic fill the edition", () => {
    const politics = [10, 9, 9, 8, 8, 7].map((n) => group(n, "politics"));
    const tech = group(3, "tech");
    const thinSports = group(2, "sports");
    const picked = pickBalanced([...politics, tech, thinSports], opts);
    // Politics gets its front-page stories plus its section's share; tech and a thin sports story still appear.
    expect(picked.filter((p) => p.topic === "politics").length).toBeLessThan(politics.length);
    expect(picked).toContain(tech);
    expect(picked).toContain(thinSports);
  });

  it("fills a short section with 2-outlet stories, after the wider ones", () => {
    const strong = group(4, "science");
    const thin = group(2, "science");
    const picked = pickBalanced([strong, thin], { ...opts, front: 0 });
    expect(picked).toEqual([strong, thin]);
  });

  it("adds blindspots and keeps the ranked order", () => {
    const front = group(9, "world");
    const blind = group(5, null, true);
    expect(blind.blindspot).toBe("left");
    const picked = pickBalanced([front, blind], opts);
    expect(picked).toEqual([front, blind]);
  });

  it("leads the front page with the most important story, not the most repeated one", () => {
    const joke = group(10, "politics", false, 2);
    const ruling = group(6, "politics", false, 5);
    const picked = pickBalanced([joke, ruling], { ...opts, front: 1, perSection: 0 });
    expect(picked).toEqual([ruling]);
  });

  it("leaves gossip and puzzle hints out of the edition, and minor news off the front page", () => {
    const gossip = group(10, "culture", false, 1);
    const oneSidedGossip = group(5, null, true, 1);
    expect(oneSidedGossip.blindspot).toBe("left");
    expect(pickBalanced([gossip, oneSidedGossip], opts)).toEqual([]);
    // Minor news (2) can fill its own section but never the front page.
    const minor = group(10, "sports", false, 2);
    expect(pickBalanced([minor], opts)).toEqual([minor]);
    expect(frontPage([minor], 5).size).toBe(0);
  });

  it("keeps one subtopic to half a section while other stories wait", () => {
    const f1 = [9, 9, 8, 8, 7, 7].map((n) => ({ ...group(n, "sports", false, 2), subtopic: "f1" }));
    const nfl = [3, 3].map((n) => ({ ...group(n, "sports", false, 2), subtopic: "nfl" }));
    const picked = pickBalanced([...f1, ...nfl], { ...opts, front: 0, perSection: 4 });
    expect(picked.filter((p) => p.subtopic === "f1")).toHaveLength(2);
    expect(picked).toEqual(expect.arrayContaining(nfl));
    // With nothing else waiting, the subtopic fills the section.
    expect(pickBalanced(f1, { ...opts, front: 0, perSection: 4 })).toHaveLength(4);
  });

  it("caps the total", () => {
    const many = TOPIC_IDS.flatMap((t) => [group(5, t), group(4, t), group(3, t)]);
    expect(pickBalanced(many, { ...opts, max: 7 })).toHaveLength(7);
  });
});

describe("frontPage", () => {
  it("takes stories both sides covered with enough outlets, most important then widest first", () => {
    const a = { id: "a", importance: 4, blindspot: null, coverage: coverageOf([L[0]!, R[0]!, C[0]!, C[1]!, C[2]!, C[3]!, C[4]!]) };
    const b = { id: "b", importance: 3, blindspot: null, coverage: coverageOf([R[0]!, R[1]!, R[2]!, R[3]!, C[0]!, C[1]!]) };
    const c = { id: "c", importance: 5, blindspot: null, coverage: coverageOf([L[0]!, R[0]!, C[0]!, C[1]!, C[2]!, C[3]!]) };
    const thin = { id: "thin", importance: 5, blindspot: null, coverage: coverageOf([L[0]!, R[0]!, C[0]!]) };
    // The thin one is importance 5, which needs only 3 outlets; b (importance 3) lacks a left-leaning outlet.
    expect([...frontPage([thin, b, a, c], 5)].map((s) => s.id)).toEqual(["c", "thin", "a"]);
  });

  it("orders by consequence, with breadth as a capped bonus", () => {
    const rally = { id: "rally", importance: 2, blindspot: null, coverage: coverageOf([...L.slice(0, 6), ...C.slice(0, 6), ...R.slice(0, 5)]) };
    const attack = { id: "attack", importance: 5, blindspot: null, coverage: coverageOf([L[0]!, R[0]!, C[0]!]) };
    const letter = { id: "letter", importance: 4, blindspot: null, coverage: coverageOf([L[0]!, L[1]!, R[0]!, C[0]!, C[1]!, C[2]!]) };
    // The minor rally has the most outlets, but breadth can't lift it past two importance steps.
    expect([...frontPage([letter, rally, attack], 2)].map((s) => s.id)).toEqual(["attack", "letter"]);
    expect([...frontPage([letter, rally, attack], 3)].map((s) => s.id)).toEqual(["attack", "letter", "rally"]);
  });

  it("keeps a front slot for a story most of the press covered, unless it's minor", () => {
    const major = (id: string) => ({ id, importance: 5, blindspot: null, coverage: coverageOf([L[0]!, R[0]!, C[0]!, C[1]!, C[2]!, C[3]!]) });
    const wide17 = [...L.slice(0, 5), ...C.slice(0, 7), ...R.slice(0, 5)];
    const protests = { id: "protests", importance: 3, blindspot: null, coverage: coverageOf(wide17) };
    const rally = { id: "rally", importance: 2, blindspot: null, coverage: coverageOf(wide17) };
    const ids = [...frontPage([major("a"), major("b"), protests, rally], 2)].map((s) => s.id);
    expect(ids).toEqual(["a", "b", "protests"]);
  });

  it("puts the newest important story on top", () => {
    const now = 100 * 3600_000;
    const wide = coverageOf([...L.slice(0, 3), ...C.slice(0, 3), ...R.slice(0, 3)]);
    const old = { id: "old", importance: 5, blindspot: null, coverage: wide, fresh: freshness(5, now - 20 * 3600_000, now) };
    const breaking = { id: "new", importance: 4, blindspot: null, coverage: wide, fresh: freshness(4, now - 600_000, now) };
    expect([...frontPage([old, breaking], 2)].map((s) => s.id)).toEqual(["new", "old"]);
    // Freshness only lifts important news.
    expect(freshness(3, now, now)).toBe(0);
  });

  it("lets a story that broke hours ago give up the lead to newer news, however much it's still reported", () => {
    const now = 100 * 3600_000;
    const widest = coverageOf([...L.slice(0, 4), ...C.slice(0, 4), ...R.slice(0, 4)]);
    const narrower = coverageOf([...L.slice(0, 2), ...C.slice(0, 2), ...R.slice(0, 2)]);
    // Follow-ups on yesterday's election keep arriving; the newer story broke 3 hours ago.
    const election = { id: "election", importance: 4, blindspot: null, coverage: widest, fresh: freshness(4, now - 15 * 3600_000, now) };
    const talks = { id: "talks", importance: 4, blindspot: null, coverage: narrower, fresh: freshness(4, now - 3 * 3600_000, now) };
    expect([...frontPage([election, talks], 2)].map((s) => s.id)).toEqual(["talks", "election"]);
  });

  it("always picks importance-5 stories, however narrow, over wider minor ones", () => {
    const wideMinor = (id: string) => ({ id, topic: "world" as const, importance: 2, blindspot: null, latest: 0, members: [], coverage: coverageOf([...L.slice(0, 3), ...C.slice(0, 3), ...R.slice(0, 3)]) });
    const attack = { id: "attack", topic: "world" as const, importance: 5, blindspot: null, latest: 0, members: [], coverage: coverageOf([L[0]!, R[0]!, R[1]!]) };
    const picked = pickBalanced([wideMinor("a"), wideMinor("b"), wideMinor("c"), wideMinor("d"), attack], { front: 0, perSection: 3, blindspots: 0, max: 30 });
    expect(picked.map((c) => c.id)).toContain("attack");
  });

  it("lets a very important story one side skipped lead, as a possible blindspot", () => {
    const skipped = { id: "s", importance: 4, blindspot: "right" as const, coverage: coverageOf([...L.slice(0, 4), C[0]!, C[1]!]) };
    const minorSkipped = { ...skipped, id: "m", importance: 3 };
    expect([...frontPage([skipped, minorSkipped], 5)].map((s) => s.id)).toEqual(["s"]);
  });
});

describe("section caps", () => {
  it("gives busy sections room for ten stories and quieter ones fewer", () => {
    const groups = (topic: TopicId, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${topic}${i}`, topic, importance: 3, blindspot: null, latest: 0, members: [], coverage: coverageOf([L[i % L.length]!, R[i % R.length]!, C[i % C.length]!]) }));
    const picked = pickBalanced([...groups("world", 14), ...groups("science", 8)], { front: 0, perSection: 6, sections: { world: 10, science: 4 }, blindspots: 0, max: 80 });
    expect(picked.filter((p) => p.topic === "world")).toHaveLength(10);
    expect(picked.filter((p) => p.topic === "science")).toHaveLength(4);
  });

  it("treats technology and AI as busy sections, with room in the edition for every cap", () => {
    expect(SECTION_CAPS.tech).toBe(10);
    expect(SECTION_CAPS.ai).toBe(10);
    expect(BALANCE.max).toBeGreaterThanOrEqual(Object.values(SECTION_CAPS).reduce((a, b) => a + b, 0) + BALANCE.front + BALANCE.blindspots);
    const groups = (topic: TopicId, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${topic}${i}`, topic, importance: 3, blindspot: null, latest: 0, members: [], coverage: coverageOf([L[i % L.length]!, R[i % R.length]!, C[i % C.length]!]) }));
    const picked = pickBalanced([...groups("tech", 12), ...groups("ai", 12)], { ...BALANCE, front: 0 });
    expect(picked.filter((p) => p.topic === "tech")).toHaveLength(10);
    expect(picked.filter((p) => p.topic === "ai")).toHaveLength(10);
  });
});
