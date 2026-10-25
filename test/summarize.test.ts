import { describe, expect, it } from "vitest";
import { clean, extractJson, repeats, replyText, sourceBlock, speculative, splitInline, summarize, validateWriteup, type AiRunner, type SourceItem } from "../src/build/summarize";

const items: SourceItem[] = [
  { id: "i1", outletId: "vox", title: "Senate passes funding bill", snippet: "The vote was 52-48." },
  { id: "i2", outletId: "fox", title: "Senate approves spending package", snippet: "Republicans split on the measure." },
  { id: "i3", outletId: "bbc", title: "US Senate votes on budget", snippet: "" },
  { id: "i4", outletId: "nypost", title: "Celebrity opens restaurant", snippet: "Unrelated." },
];

const good = {
  topic: "politics",
  headline: "“Senate passes funding bill 52-48”",
  summary: [
    { text: "The Senate passed a funding bill  52-48.", sources: ["s1", "s3"] },
    { text: "Fox News reported Republicans split.", sources: ["s2"] },
    { text: "Made-up sentence.", sources: [] },
    { text: "Cites a missing source.", sources: ["s9"] },
    { text: "Cites the off-topic one.", sources: ["s4"] },
    { text: "As s2 reported, it passed.", sources: ["s2"] },
    { text: "Samsung shipped the Galaxy S24.", sources: ["s3"] },
  ],
  differences: [
    { kind: "framing", text: "Vox says 'funding bill'; Fox says 'spending package'.", sources: ["s1", "s2"] },
    { kind: "fact", text: "Only one outlet.", sources: ["s1"] },
    { kind: "omission", text: "Only Fox mentions the Republican split.", sources: ["s2"] },
    { kind: "vibes", text: "Bad kind.", sources: ["s1", "s2"] },
    { kind: "fact", text: "s1 and s2 disagree.", sources: ["s1", "s2"] },
  ],
  off_topic: ["s4"],
};

describe("validateWriteup", () => {
  it("keeps cited sentences, maps labels to ids and drops the rest", () => {
    const w = validateWriteup(good, items)!;
    expect(w.headline).toBe("Senate passes funding bill 52-48");
    expect(w.topic).toBe("politics");
    expect(w.summary).toEqual([
      { text: "The Senate passed a funding bill 52-48.", cites: ["i1", "i3"] },
      { text: "Fox News reported Republicans split.", cites: ["i2"] },
      { text: "Samsung shipped the Galaxy S24.", cites: ["i3"] },
    ]);
    // "omission" is no longer a kind new write-ups may use, and "fact" from one outlet isn't a difference.
    expect(w.differences.map((d) => d.kind)).toEqual(["framing"]);
    expect(w.offTopic).toEqual(["i4"]);
  });

  it("returns null when no sentence survives or the shape is wrong", () => {
    expect(validateWriteup({ ...good, summary: [{ text: "x", sources: [] }] }, items)).toBeNull();
    expect(validateWriteup({ headline: "x" }, items)).toBeNull();
    expect(validateWriteup(null, items)).toBeNull();
  });

  it("falls back to world for an unknown topic", () => {
    expect(validateWriteup({ ...good, topic: "gossip" }, items)?.topic).toBe("world");
  });
});

describe("speculative", () => {
  it("flags any hedged forecast, even one a source makes, and keeps stated consequences", () => {
    expect(speculative({ text: "It could influence voters ahead of the midterms.", cites: ["a"] })).toBe(true);
    expect(speculative({ text: "The plant may add about 4,500 jobs.", cites: ["a"] })).toBe(true);
    expect(speculative({ text: "About 4,500 people will work there.", cites: ["a"] })).toBe(false);
    // Vague significance reads as a hedge too.
    expect(speculative({ text: "The outcome is seen as influencing U.S. influence in Latin America.", cites: ["a"] })).toBe(true);
    expect(speculative(null)).toBe(false);
  });
});

describe("repeats", () => {
  it("catches a why-line that restates a summary sentence", () => {
    expect(repeats("The runoff could reshape Latin American politics and U.S. influence.", ["The runoff could reshape politics in Latin America and U.S. influence there."])).toBe(true);
    expect(repeats("About 4,500 people would work at the plant.", ["Audi will build a factory in Georgia."])).toBe(false);
  });
});

describe("splitInline", () => {
  it("splits a paragraph into sentences that keep only their own citations", () => {
    expect(splitInline('The Senate passed it [s1, s3]. Fox said Republicans split ["s2"]. Samsung shipped the Galaxy S24 [s4]. No source here.')).toEqual([
      { text: "The Senate passed it.", sources: ["s1", "s3"] },
      { text: "Fox said Republicans split.", sources: ["s2"] },
      { text: "Samsung shipped the Galaxy S24.", sources: ["s4"] },
      { text: "No source here.", sources: [] },
    ]);
  });

  it("handles a marker after the period and keeps non-citation brackets", () => {
    expect(splitInline("It was restored. [s5] Officials [unnamed] confirmed it [s2].")).toEqual([
      { text: "It was restored.", sources: ["s5"] },
      { text: "Officials [unnamed] confirmed it.", sources: ["s2"] },
    ]);
  });

  it("is accepted by validateWriteup, which still drops uncited sentences", () => {
    const w = validateWriteup({ ...good, summary: "The Senate passed it [s1]. Nobody cited this." }, items);
    expect(w?.summary).toEqual([{ text: "The Senate passed it.", cites: ["i1"] }]);
  });
});

describe("replyText / extractJson", () => {
  it("reads the binding's reply shapes", () => {
    expect(replyText({ response: "hi" })).toBe("hi");
    expect(replyText({ response: { a: 1 } })).toBe('{"a":1}');
    expect(replyText({ choices: [{ message: { content: "yo" } }] })).toBe("yo");
    expect(replyText({ output: [{ type: "reasoning" }, { type: "message", content: [{ text: "ok" }] }] })).toBe("ok");
    expect(replyText(42)).toBe("");
  });

  it("pulls JSON out of fenced text", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson("nothing")).toBeNull();
    expect(extractJson("{broken")).toBeNull();
  });
});

describe("sourceBlock", () => {
  it("numbers sources and labels the outlet's lean", () => {
    expect(sourceBlock(items.slice(0, 2))).toBe(
      "[s1] Vox (left)\nHeadline: Senate passes funding bill\nDescription: The vote was 52-48.\n\n[s2] Fox News (right)\nHeadline: Senate approves spending package\nDescription: Republicans split on the measure.",
    );
  });
});

/** A fake model: answers write-ups with `reply`, and the check pass with `verdicts` (default: all supported). */
function fakeModel(reply: unknown, verdicts?: (n: number) => boolean[]): { ai: AiRunner; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  const ai: AiRunner = {
    run: async (_m, input) => {
      calls.push(input);
      const [system, user] = (input.messages as { content: string }[]).map((m) => m.content);
      if (system!.startsWith("You check a news summary")) {
        const n = (user!.match(/^\[\d+\]/gm) ?? []).length;
        return { response: JSON.stringify({ supported: verdicts ? verdicts(n) : Array(n).fill(true) }) };
      }
      return { response: JSON.stringify(reply) };
    },
  };
  return { ai, calls };
}

describe("summarize", () => {
  it("sends the sources and today's date to the model, then checks the reply", async () => {
    const { ai, calls } = fakeModel(good);
    const w = await summarize(ai, items, Date.parse("2026-10-25T12:00:00Z"));
    expect(w?.summary).toHaveLength(3);
    expect(JSON.stringify(calls[0])).toContain("[s4] New York Post (leans right)");
    expect(JSON.stringify(calls[0])).toContain("Today is Sunday, October 25, 2026");
    expect(calls).toHaveLength(2);
  });

  it("drops sentences the check pass finds unsupported", async () => {
    const { ai } = fakeModel(good, (n) => Array.from({ length: n }, (_, i) => i !== 1));
    const w = await summarize(ai, items);
    expect(w?.summary.map((s) => s.text)).toEqual(["The Senate passed a funding bill 52-48.", "Samsung shipped the Galaxy S24."]);
  });

  it("holds the story back when the check pass fails or nothing survives", async () => {
    expect(await summarize(fakeModel(good, (n) => Array(n).fill(false)).ai, items)).toBeNull();
    expect(await summarize(fakeModel(good, () => [true]).ai, items)).toBeNull();
  });
});

describe("clean", () => {
  it("collapses whitespace and rewrites an 'at least X to Y' range", () => {
    expect(clean("  A shooting   injured at least 11 to 12 people. ")).toBe("A shooting injured 11 or 12 people.");
    expect(clean("At least 11 people were hurt.")).toBe("At least 11 people were hurt.");
  });
});
