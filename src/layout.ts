import type { Story } from "./editions";
import { TOPICS, type TopicId } from "./topics";

export type TopicSection = { id: TopicId; name: string; followed: boolean; stories: Story[] };
export type EditionLayout = { front: Story[]; blindspots: Story[]; topics: TopicSection[] };

/** Within a section, stories only one side covered (no center either) go last. */
const oneSidedLast = (list: Story[]) => {
  const oneSided = (s: Story) => s.coverage.center === 0 && (s.coverage.left === 0 || s.coverage.right === 0);
  return [...list.filter((s) => !oneSided(s)), ...list.filter(oneSided)];
};

/**
 * How an edition is laid out, on the site and in the app alike: the front page, then blindspots, then each
 * section, with the sections a reader follows first.
 */
export function editionLayout(stories: readonly Story[], following: readonly string[] = []): EditionLayout {
  const followed = new Set(following);
  const topics = TOPICS.map((t) => ({
    id: t.id,
    name: t.name,
    followed: followed.has(t.id),
    stories: oneSidedLast(stories.filter((s) => !s.front && !s.blindspot && s.topic === t.id)),
  }))
    .filter((g) => g.stories.length > 0)
    .sort((a, b) => Number(b.followed) - Number(a.followed));
  return { front: stories.filter((s) => s.front), blindspots: stories.filter((s) => !s.front && s.blindspot), topics };
}
