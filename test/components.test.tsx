import { describe, expect, it } from "vitest";
import { coverageOf } from "../src/build/select";
import { cardLine, shownSummary, type Source, type Story } from "../src/editions";
import { outletById, SIDE_SIZE } from "../src/outlets";
import { badge, kindLabel, orderedSources, readFirst, Scale, StoryCard, strongest } from "../src/web/components";

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

  it("links citations within the page on the story page and explains a blindspot", async () => {
    const html = await render(<StoryCard story={{ ...story, blindspot: "left" }} sources={sources} page />);
    expect(html).toContain('href="#src-1"');
    expect(html).toContain("Why it&#39;s here");
    // Without a blindspot the line would only repeat the kicker's counts.
    expect(await render(<StoryCard story={story} sources={sources} page />)).not.toContain("Why it&#39;s here");
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

  it("collapses to one line when there's too little to compare", async () => {
    const html = await render(<Scale c={coverageOf(["vox", "axios", "pbs", "fox"])} />);
    expect(html).toContain('class="scale thin"');
    expect(html).not.toContain("needle");
  });
});

describe("card helpers", () => {
  it("marks only new stories, not rewrites", () => {
    const now = 10 * 3600_000;
    expect(badge({ ...story, firstSeenAt: now - 600_000 }, now)).toBe("New");
    expect(badge({ ...story, firstSeenAt: now - 4 * 3600_000, writtenAt: now - 600_000 }, now)).toBeNull();
    expect(badge({ ...story, firstSeenAt: now - 9 * 3600_000 }, now)).toBeNull();
  });

  it("quotes the first two cited sources, which the write-up lists as its clearest example", () => {
    expect(strongest(["i2", "i0", "i1"], sources).map((s) => s.outlet.id)).toEqual(["axios", "fox"]);
    expect(strongest(["missing", "i3"], sources).map((s) => s.outlet.id)).toEqual(["nyt"]);
  });

  it("labels a count difference by time when the reports are hours apart", () => {
    const timed = new Map(sources);
    timed.set("i0", { ...sources.get("i0")!, publishedAt: 0 });
    timed.set("i1", { ...sources.get("i1")!, publishedAt: 3 * 3600_000 });
    timed.set("i2", { ...sources.get("i2")!, publishedAt: 1800_000 });
    expect(kindLabel("fact", ["i1", "i0"], timed)).toBe("Earlier and later reports");
    expect(kindLabel("fact", ["i0", "i2"], timed)).toBe("Facts differ");
    expect(kindLabel("framing", ["i1", "i0"], timed)).toBe("Framing");
    expect(strongest(["i1", "i0"], timed).map((x) => x.id)).toEqual(["i0", "i1"]);
  });

  it("quotes the source's description under its headline on the story page", async () => {
    const withSnippet = new Map(sources);
    withSnippet.set("i0", { ...sources.get("i0")!, snippet: "Officials said nine people died." });
    const differing: Story = { ...story, differences: [{ kind: "fact", text: "Tolls differ.", cites: ["i0", "i1"] }] };
    const html = await render(<StoryCard story={differing} sources={withSnippet} page />);
    expect(html).toContain('<q class="snippet">Officials said nine people died.</q>');
  });

  it("starts readers at an explainer when there is one", () => {
    const withExplainer = new Map(sources);
    withExplainer.set("i3", { ...sources.get("i3")!, title: "What to Know About the Vote" });
    expect(readFirst(story, withExplainer)?.outlet.id).toBe("nyt");
  });

  it("starts readers at a well-known center outlet", async () => {
    expect(readFirst(story, sources)?.outlet.id).toBe("pbs");
    const html = await render(<StoryCard story={story} sources={sources} page />);
    expect(html).toContain("Read first");
    expect(html).toContain("https://pbs.test/a");
  });
});

describe("cardLine", () => {
  it("replaces a line that only restates the headline with the next one that stands alone, or nothing", () => {
    const echo: Story = { ...story, dek: { text: "Something happened.", cites: ["i0"] } };
    expect(cardLine(echo)).toBe("Everyone reported it.");
    // A dek with a doubled word ("Starlink and Starlink") gives way to the first summary sentence.
    expect(cardLine({ ...story, dek: { text: "Starlink and Starlink speeds are back.", cites: ["i0"] } })).toBe("Everyone reported it.");
    const followOn: Story = { ...echo, summary: [{ text: "Officials also responded.", cites: ["i0"] }] };
    expect(cardLine(followOn)).toBe("");
    expect(cardLine({ ...story, dek: { text: "A fresh detail.", cites: ["i0"] } })).toBe("A fresh detail.");
  });
});

describe("shownSummary", () => {
  it("leaves out a sentence that only restates the headline", () => {
    const echo: Story = { ...story, summary: [{ text: "Something happened.", cites: ["i0"] }, ...story.summary] };
    expect(shownSummary(echo).map((x) => x.text)).toEqual(story.summary.map((x) => x.text));
    expect(shownSummary({ ...story, summary: [{ text: "Something happened.", cites: ["i0"] }] })).toHaveLength(1);
  });
});

describe("article text", () => {
  const long: Story = {
    ...story,
    summary: Array.from({ length: 6 }, (_, i) => ({ text: `Sentence ${i + 1}.`, cites: ["i0"] })),
  };

  it("shows the lead's opening with a link to the rest, and the whole article in paragraphs on its page", async () => {
    const lead = await render(<StoryCard story={long} sources={sources} lead />);
    expect(lead).toContain("Sentence 4.");
    expect(lead).not.toContain("Sentence 5.");
    expect(lead).toContain("Continue reading");
    const page = await render(<StoryCard story={long} sources={sources} page />);
    expect(page).toContain("Sentence 6.");
    expect(page.match(/<p class="summary">/g)).toHaveLength(2);
    expect(page).not.toContain("Continue reading");
  });
});

describe("where accounts differ", () => {
  it("starts collapsed, on the story page too", async () => {
    const differing: Story = { ...story, differences: [{ kind: "fact", text: "Tolls differ.", cites: ["i0", "i1"] }] };
    const html = await render(<StoryCard story={differing} sources={sources} page />);
    expect(html).toContain('<details class="differ">');
    expect(html).not.toContain('class="differ" open');
  });
});
