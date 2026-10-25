import { describe, expect, it } from "vitest";
import { classifyGroups, CLASSIFY_INSTRUCTIONS, parseClassification } from "../src/build/classify";
import type { AiRunner } from "../src/build/summarize";
import { SUBTOPICS, TOPIC_IDS } from "../src/topics";

describe("parseClassification", () => {
  it("keeps a section with one of its own subtopics", () => {
    expect(parseClassification({ section: "sports", subtopic: "f1", importance: 3 })).toEqual({ topic: "sports", subtopic: "f1", importance: 3 });
    expect(parseClassification({ section: "ai", subtopic: "ai-policy", importance: 4 })).toEqual({ topic: "ai", subtopic: "ai-policy", importance: 4 });
  });

  it("drops a missing, null or unknown subtopic but keeps the section", () => {
    expect(parseClassification({ section: "tech", importance: 2 })).toEqual({ topic: "tech", subtopic: null, importance: 2 });
    expect(parseClassification({ section: "tech", subtopic: null, importance: 2 }).subtopic).toBeNull();
    expect(parseClassification({ section: "tech", subtopic: "quantum", importance: 2 }).subtopic).toBeNull();
    expect(parseClassification({ section: "tech", subtopic: 7, importance: 2 }).subtopic).toBeNull();
  });

  it("drops a subtopic that belongs to another section, and never lets one pick the section", () => {
    expect(parseClassification({ section: "world", subtopic: "f1", importance: 3 })).toEqual({ topic: "world", subtopic: null, importance: 3 });
    expect(parseClassification({ section: "gossip", subtopic: "f1", importance: 3 })).toEqual({ topic: null, subtopic: null, importance: 3 });
  });

  it("reads a bare section id and ignores junk", () => {
    expect(parseClassification("science")).toEqual({ topic: "science", subtopic: null, importance: null });
    expect(parseClassification(null)).toEqual({ topic: null, subtopic: null, importance: null });
    expect(parseClassification({ section: "sports", subtopic: "f1", importance: 9 }).importance).toBeNull();
  });
});

describe("subtopics", () => {
  it("have unique ids that never reuse a section id, each under a real section", () => {
    const ids = SUBTOPICS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => (TOPIC_IDS as readonly string[]).includes(id))).toBe(false);
    expect(SUBTOPICS.every((s) => TOPIC_IDS.includes(s.section))).toBe(true);
  });

  it("are listed for the model under their sections", () => {
    expect(CLASSIFY_INSTRUCTIONS).toContain("sports: nfl (NFL)");
    expect(CLASSIFY_INSTRUCTIONS).toContain("f1 (Formula 1)");
    expect(CLASSIFY_INSTRUCTIONS).toContain("ai (Artificial Intelligence)");
  });
});

describe("classifyGroups", () => {
  it("parses each group's reply and leaves unanswered groups null", async () => {
    const ai: AiRunner = {
      run: async () => ({ response: JSON.stringify({ g1: { section: "sports", subtopic: "f1", importance: 3 }, g2: { section: "business", subtopic: "nba", importance: 2 } }) }),
    };
    const out = await classifyGroups(ai, [[{ title: "Verstappen wins in Austin" }], [{ title: "Stocks rise" }], [{ title: "Unanswered" }]]);
    expect(out).toEqual([
      { topic: "sports", subtopic: "f1", importance: 3 },
      { topic: "business", subtopic: null, importance: 2 },
      { topic: null, subtopic: null, importance: null },
    ]);
  });
});
