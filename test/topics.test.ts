import { describe, expect, it } from "vitest";
import type { Story } from "../src/editions";
import { editionLayout, follows } from "../src/layout";
import { interestName, isInterestId, subtopicUnder } from "../src/topics";

const story = (id: string, topic: string, subtopic: string | null) =>
  ({ id, topic, subtopic, front: false, blindspot: null, coverage: { left: 3, center: 1, right: 3, unrated: 0, total: 7, balance: 0 } }) as unknown as Story;

describe("topics", () => {
  it("knows sections and subtopics, and checks a subtopic's section", () => {
    expect(isInterestId("ai")).toBe(true);
    expect(isInterestId("f1")).toBe(true);
    expect(isInterestId("gossip")).toBe(false);
    expect(interestName("f1")).toBe("Formula 1");
    expect(interestName("ai")).toBe("Artificial Intelligence");
    expect(subtopicUnder("sports", "f1")).toBe("f1");
    expect(subtopicUnder("world", "f1")).toBeNull();
    expect(subtopicUnder(null, "f1")).toBeNull();
  });

  it("follows a story by its section or its subtopic", () => {
    const race = story("a", "sports", "f1");
    expect(follows(["f1"], race)).toBe(true);
    expect(follows(["sports"], race)).toBe(true);
    expect(follows(["nfl"], race)).toBe(false);
    expect(follows(["f1"], story("b", "sports", null))).toBe(false);
  });

  it("puts a section first when the reader follows one of its subtopics", () => {
    const layout = editionLayout([story("a", "world", null), story("b", "sports", "f1")], ["f1"]);
    expect(layout.topics.map((t) => [t.id, t.followed])).toEqual([["sports", true], ["world", false]]);
  });
});
