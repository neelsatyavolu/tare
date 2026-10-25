import type { Story } from "./editions";
import { subtopicsOf, TOPICS, type TopicId } from "./topics";

export type TopicSection = { id: TopicId; name: string; followed: boolean; stories: Story[] };
export type EditionLayout = { front: Story[]; blindspots: Story[]; topics: TopicSection[] };

/** Whether a reader following `topics` (section and subtopic ids) follows this story: its section or its subtopic. */
export const follows = (topics: readonly string[], s: Story) => topics.includes(s.topic) || (!!s.subtopic && topics.includes(s.subtopic));

/** Within a section, stories only one side covered (no center either) go last. */
const oneSidedLast = (list: Story[]) => {
  const oneSided = (s: Story) => s.coverage.center === 0 && (s.coverage.left === 0 || s.coverage.right === 0);
  return [...list.filter((s) => !oneSided(s)), ...list.filter(oneSided)];
};

/**
 * How an edition is laid out, on the site and in the app alike: the front page, then blindspots, then each
 * section, with the sections a reader follows first (following one of a section's subtopics counts).
 */
export function editionLayout(stories: readonly Story[], following: readonly string[] = []): EditionLayout {
  const followed = new Set(following);
  const topics = TOPICS.map((t) => ({
    id: t.id,
    name: t.name,
    followed: followed.has(t.id) || subtopicsOf(t.id).some((s) => followed.has(s.id)),
    stories: oneSidedLast(stories.filter((s) => !s.front && !s.blindspot && s.topic === t.id)),
  }))
    .filter((g) => g.stories.length > 0)
    .sort((a, b) => Number(b.followed) - Number(a.followed));
  return { front: stories.filter((s) => s.front), blindspots: stories.filter((s) => !s.front && s.blindspot), topics };
}
