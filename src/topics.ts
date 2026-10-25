export const TOPICS = [
  { id: "world", name: "World" },
  { id: "us", name: "U.S." },
  { id: "politics", name: "U.S. Politics" },
  { id: "business", name: "Business & Finance" },
  { id: "tech", name: "Technology" },
  { id: "science", name: "Science & Health" },
  { id: "climate", name: "Climate & Environment" },
  { id: "culture", name: "Culture & Entertainment" },
  { id: "sports", name: "Sports" },
] as const;

export type TopicId = (typeof TOPICS)[number]["id"];

export const TOPIC_IDS = TOPICS.map((t) => t.id) as [TopicId, ...TopicId[]];

const NAMES = new Map<string, string>(TOPICS.map((t) => [t.id, t.name]));

export function topicName(id: string): string {
  return NAMES.get(id) ?? "Other";
}

export function isTopicId(id: string): id is TopicId {
  return NAMES.has(id);
}
