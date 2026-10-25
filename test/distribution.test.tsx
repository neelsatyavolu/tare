import { describe, expect, it } from "vitest";
import { coverageOf } from "../src/build/select";
import { acrossSpectrum, BUCKETS, bucketOf, distributionOf, distributionSentence, ratedOf, storyOutlets, ZETA_SPAN } from "../src/distribution";
import type { Source, Story } from "../src/editions";
import { OUTLETS, ZETA_EDGES, type Lean, type Outlet } from "../src/outlets";
import { StoryCard } from "../src/web/components";
import { DistBar, distributionLabel, ReadAcross, Spectrum, spectrumMarks, xOf } from "../src/web/spectrum";

// Outlets by lean, read from the list so the tests survive a refresh of it.
const byLean = (lean: Lean) => OUTLETS.filter((o) => o.lean === lean);
const pickOutlets: Outlet[] = [
  ...byLean("left").slice(0, 2),
  ...byLean("lean-left").slice(0, 3),
  ...byLean("center").slice(0, 2),
  ...byLean("lean-right").slice(0, 1),
  ...byLean("right").slice(0, 2),
  ...byLean("unrated").slice(0, 2),
];
const unratedNames = byLean("unrated").slice(0, 2).map((o) => o.name);

const sourceFor = (o: Outlet, i: number): Source => ({ id: `i${i}`, outlet: o, title: `${o.name} headline ${i}`, url: `https://${o.id}.test/${i}`, publishedAt: i, imageUrl: null });

function storyOf(outlets: readonly Outlet[], extra: Outlet[] = []): { story: Story; sources: Map<string, Source> } {
  // `extra` adds a second item from an outlet already present, which must not count twice.
  const all = [...outlets, ...extra];
  const sources = new Map(all.map((o, i) => [`i${i}`, sourceFor(o, i)]));
  const story: Story = {
    id: "d".repeat(32), editionDate: "2026-10-25", rank: 0, front: false, topic: "politics", subtopic: null, headline: "A vote",
    summary: [{ text: "It passed.", cites: [...sources.keys()] }], differences: [], coverage: coverageOf(all.map((o) => o.id)),
    blindspot: null, itemIds: [...sources.keys()], imageItemId: null, firstSeenAt: null, importance: 3, dek: null, why: null, writtenAt: null,
  };
  return { story, sources };
}

const render = async (node: unknown) => String(await Promise.resolve(node));

describe("distribution", () => {
  it("counts distinct outlets per bucket, and the buckets plus unrated add up to the total", () => {
    const { story, sources } = storyOf(pickOutlets, [pickOutlets[0]!]);
    const d = distributionOf(storyOutlets(story, sources));
    expect(d).toEqual({ left: 2, leanLeft: 3, center: 2, leanRight: 1, right: 2, unrated: 2, total: 12 });
    expect(BUCKETS.reduce((n, b) => n + d[b], 0) + d.unrated).toBe(d.total);
    expect(ratedOf(d)).toBe(10);
    // The same outlets as the three-side coverage the build stored.
    expect(d.left + d.leanLeft).toBe(story.coverage.left);
    expect(d.right + d.leanRight).toBe(story.coverage.right);
    expect(d.unrated).toBe(story.coverage.unrated);
  });

  it("buckets every outlet by its lean, and unrated ones into none", () => {
    for (const o of OUTLETS) expect(bucketOf(o.lean) === null).toBe(o.zeta === null);
  });

  it("describes the counts in plain words", () => {
    expect(distributionSentence({ left: 2, leanLeft: 3, center: 1, leanRight: 0, right: 0, unrated: 1, total: 7 })).toBe(
      "Of the 6 rated outlets that covered it, 5 are left of center (2 of them in the Left group), 1 is center and 0 are right of center. 1 more is not rated.",
    );
    expect(distributionSentence({ left: 0, leanLeft: 0, center: 0, leanRight: 0, right: 0, unrated: 3, total: 3 })).toContain("None of the 3 outlets");
  });
});

describe("Spectrum", () => {
  it("places rated outlets only, in score order, without overlapping dots in a row", () => {
    const marks = spectrumMarks(pickOutlets);
    expect(marks).toHaveLength(10);
    expect(marks.every((m) => m.outlet.zeta !== null)).toBe(true);
    expect(marks.map((m) => m.x)).toEqual([...marks.map((m) => m.x)].sort((a, b) => a - b));
    for (const a of marks) for (const b of marks) if (a !== b && a.level === b.level) expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(16);
  });

  it("puts zero in the middle of an axis that holds every outlet's score", () => {
    expect(xOf(0)).toBe(300);
    expect(xOf(-ZETA_SPAN)).toBe(10);
    expect(xOf(ZETA_SPAN)).toBe(590);
    expect(OUTLETS.every((o) => o.zeta === null || Math.abs(o.zeta) <= ZETA_SPAN)).toBe(true);
    expect(xOf(ZETA_EDGES.leanLeft)).toBeLessThan(xOf(0));
  });

  it("draws one titled dot per rated outlet, lists them for screen readers, and names unrated outlets apart", async () => {
    const d = distributionOf(pickOutlets);
    const html = await render(<Spectrum outlets={pickOutlets} d={d} />);
    expect(html.match(/<circle/g)).toHaveLength(10);
    expect(html.match(/<title>/g)).toHaveLength(10);
    for (const name of unratedNames) {
      expect(html).not.toContain(`<title>${name.replace(/&/g, "&amp;").replace(/'/g, "&#39;")} ·`);
      expect(html).toContain(name.replace(/&/g, "&amp;").replace(/'/g, "&#39;"));
    }
    expect(html).toContain('class="spectrum-unrated"');
    expect(html).toContain('<ul class="sr">');
    // Center line plus the four bucket edges.
    expect(html.match(/class="edge"/g)).toHaveLength(4);
    expect(html).toContain('class="zero"');
  });

  it("says so when no outlet that covered it is rated", async () => {
    const unrated = byLean("unrated").slice(0, 3);
    const html = await render(<Spectrum outlets={unrated} d={distributionOf(unrated)} />);
    expect(html).not.toContain("<circle");
    expect(html).toContain("No rated outlet covered it");
  });
});

describe("DistBar", () => {
  it("draws only rated buckets with counts as widths, and gives every count in text", async () => {
    const d = distributionOf(pickOutlets);
    const html = await render(<DistBar d={d} />);
    expect(html.match(/class="seg /g)).toHaveLength(5);
    expect(html).toContain('class="seg leanLeft" style="flex-grow:3"');
    expect(html).toContain("+2 not rated");
    expect(html).toContain(`aria-label="${distributionLabel(d)}"`);
    expect(distributionLabel(d)).toBe("Outlets by lean, left to right: 2 left, 3 leaning left, 2 center, 1 leaning right, 2 right; 2 not rated.");
  });

  it("skips empty buckets and draws nothing without outlets", async () => {
    const d = distributionOf(byLean("center").slice(0, 2));
    expect((await render(<DistBar d={d} />)).match(/class="seg /g)).toHaveLength(1);
    expect(await render(<DistBar d={distributionOf([])} />)).toBe("");
  });
});

describe("ReadAcross", () => {
  it("offers one headline from each side that covered it", async () => {
    const { story, sources } = storyOf(pickOutlets);
    const picks = acrossSpectrum(story, sources);
    expect(picks.left?.outlet.lean).toMatch(/left/);
    expect(picks.center?.outlet.lean).toBe("center");
    expect(picks.right?.outlet.lean).toMatch(/right/);
    const html = await render(<ReadAcross story={story} sources={sources} />);
    expect(html).toContain("Read across the spectrum");
    expect(html.match(/<li>/g)).toHaveLength(3);
  });

  it("says which side is missing, and stays hidden when only one side covered it", async () => {
    const two = storyOf([...byLean("left").slice(0, 2), ...byLean("center").slice(0, 1)]);
    expect(await render(<ReadAcross {...two} />)).toContain("No right-leaning outlet in Tare&#39;s list covered it.");
    const one = storyOf(byLean("right").slice(0, 3));
    expect(await render(<ReadAcross {...one} />)).toBe("");
  });
});

describe("story page and cards", () => {
  it("shows the balance block with the spectrum on the story page, and the bar on cards", async () => {
    const { story, sources } = storyOf(pickOutlets);
    const page = await render(<StoryCard story={story} sources={sources} page />);
    expect(page).toContain("How balanced is this coverage?");
    expect(page).toContain("Of the 10 rated outlets that covered it");
    expect(page).toContain('class="spectrum"');
    expect(page).not.toContain('class="dist"');
    const card = await render(<StoryCard story={story} sources={sources} />);
    expect(card).toContain('class="dist"');
    expect(card).not.toContain('class="spectrum"');
  });
});
