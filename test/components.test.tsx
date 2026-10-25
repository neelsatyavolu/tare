import { describe, expect, it } from "vitest";
import { coverageOf } from "../src/build/select";
import type { Source, Story } from "../src/editions";
import { outletById, SIDE_SIZE } from "../src/outlets";
import { orderedSources, Scale, StoryCard } from "../src/web/components";

const OUTLET_IDS = ["fox", "vox", "axios", "nyt", "nypost", "pbs"];
const sources = new Map<string, Source>(
  OUTLET_IDS.map((o, i) => [`i${i}`, { id: `i${i}`, outlet: outletById(o)!, title: `${o} headline`, url: `https://${o}.test/a`, publishedAt: 0, imageUrl: `https://img.test/${o}.jpg` }]),
);
const story: Story = {
  id: "b".repeat(32),
  editionDate: "2026-10-24",
  rank: 0,
  front: true,
  topic: "world",
  headline: "Something happened",
  summary: [
    { text: "Everyone reported it.", cites: ["i0", "i1", "i2", "i3", "i4", "i5"] },
    { text: "One outlet added a detail.", cites: ["i0"] },
  ],
  differences: [],
  coverage: coverageOf(OUTLET_IDS),
  blindspot: null,
  itemIds: [...sources.keys()],
  imageItemId: "i2",
  firstSeenAt: null,
  importance: 4,
  dek: null,
  why: null,
  writtenAt: null,
};

const render = async (node: unknown) => String(await Promise.resolve(node));

describe("orderedSources", () => {
  it("orders left, center, right, then by outlet name", () => {
    expect(orderedSources(story, sources).map((s) => s.outlet.id)).toEqual(["nyt", "vox", "axios", "pbs", "fox", "nypost"]);
  });
});

describe("StoryCard citations", () => {
  it("shows at most three source numbers, sorted, with a +N link to the full list", async () => {
    const html = await render(<StoryCard story={story} sources={sources} />);
    expect(html).toContain(`href="/s/${story.id}#src-1"`);
    expect(html).toContain(`href="/s/${story.id}#sources"`);
    expect(html).toContain("+3");
    // Fox is source 5 in display order.
    expect(html).toContain(`aria-label="Source 5">5</a>`);
  });

  it("links citations within the page on the story page and shows why it's here", async () => {
    const html = await render(<StoryCard story={story} sources={sources} page />);
    expect(html).toContain('href="#src-1"');
    expect(html).toContain("Why it&#39;s here");
    expect(html).toContain("<h1>Something happened</h1>");
  });
});

describe("StoryCard photo", () => {
  it("shows the chosen photo, credited to its outlet, without sending a referrer", async () => {
    const html = await render(<StoryCard story={story} sources={sources} />);
    expect(html).toContain('src="https://img.test/axios.jpg"');
    expect(html).toContain("Photo: Axios");
    expect(html).toContain('referrerpolicy="no-referrer"');
  });

  it("shows no photo when the story has none", async () => {
    const html = await render(<StoryCard story={{ ...story, imageItemId: null }} sources={sources} />);
    expect(html).not.toContain("<img");
  });
});

describe("Scale", () => {
  it("places the needle by balance and describes it for screen readers", async () => {
    const html = await render(<Scale c={coverageOf(["fox", "nypost", "breitbart", "axios"])} />);
    expect(html).toContain("left:100.0%");
    expect(html).toContain("No left-leaning outlets in Tare&#39;s list covered it");
    expect(html).toContain(`0 of ${SIDE_SIZE.left} left outlets`);
  });
});
