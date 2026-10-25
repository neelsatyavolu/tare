export const TOPICS = [
  { id: "world", name: "World" },
  { id: "us", name: "U.S." },
  { id: "politics", name: "U.S. Politics" },
  { id: "business", name: "Business & Finance" },
  { id: "tech", name: "Technology" },
  { id: "ai", name: "Artificial Intelligence" },
  { id: "science", name: "Science & Health" },
  { id: "climate", name: "Climate & Environment" },
  { id: "culture", name: "Culture & Entertainment" },
  { id: "sports", name: "Sports" },
] as const;

export type TopicId = (typeof TOPICS)[number]["id"];

export const TOPIC_IDS = TOPICS.map((t) => t.id) as [TopicId, ...TopicId[]];

/**
 * Narrower topics inside a section, tagged by the classifier when one fits; a story has at most one.
 * Ids are stored on stories and in readers' topic lists, so keep them stable, and never reuse a section id.
 */
export const SUBTOPICS = [
  { id: "europe", name: "Europe", section: "world" },
  { id: "mideast", name: "Middle East", section: "world" },
  { id: "asia", name: "Asia-Pacific", section: "world" },
  { id: "africa", name: "Africa", section: "world" },
  { id: "americas", name: "Americas", section: "world" },
  { id: "crime", name: "Crime & justice", section: "us" },
  { id: "immigration", name: "Immigration", section: "us" },
  { id: "congress", name: "Congress", section: "politics" },
  { id: "whitehouse", name: "White House", section: "politics" },
  { id: "courts", name: "Courts", section: "politics" },
  { id: "elections", name: "Elections", section: "politics" },
  { id: "markets", name: "Markets", section: "business" },
  { id: "economy", name: "Economy", section: "business" },
  { id: "companies", name: "Companies", section: "business" },
  { id: "crypto", name: "Crypto", section: "business" },
  { id: "gadgets", name: "Gadgets", section: "tech" },
  { id: "cyber", name: "Cybersecurity", section: "tech" },
  { id: "social", name: "Social media", section: "tech" },
  { id: "chips", name: "Chips & hardware", section: "tech" },
  { id: "ai-models", name: "Models & labs", section: "ai" },
  { id: "ai-policy", name: "AI policy", section: "ai" },
  { id: "ai-business", name: "AI business", section: "ai" },
  { id: "health", name: "Health", section: "science" },
  { id: "space", name: "Space", section: "science" },
  { id: "research", name: "Research", section: "science" },
  { id: "energy", name: "Energy", section: "climate" },
  { id: "disasters", name: "Weather & disasters", section: "climate" },
  { id: "film-tv", name: "Film & TV", section: "culture" },
  { id: "music", name: "Music", section: "culture" },
  { id: "books", name: "Books", section: "culture" },
  { id: "games", name: "Games", section: "culture" },
  { id: "nfl", name: "NFL", section: "sports" },
  { id: "nba", name: "NBA", section: "sports" },
  { id: "mlb", name: "MLB", section: "sports" },
  { id: "nhl", name: "NHL", section: "sports" },
  { id: "soccer", name: "Soccer", section: "sports" },
  { id: "f1", name: "Formula 1", section: "sports" },
  { id: "tennis", name: "Tennis", section: "sports" },
  { id: "golf", name: "Golf", section: "sports" },
  { id: "college", name: "College sports", section: "sports" },
] as const satisfies readonly { id: string; name: string; section: TopicId }[];

export type SubtopicId = (typeof SUBTOPICS)[number]["id"];
/** What a reader can follow: a whole section or one subtopic. */
export type InterestId = TopicId | SubtopicId;

const NAMES = new Map<string, string>(TOPICS.map((t) => [t.id, t.name]));
const SUBS = new Map<string, (typeof SUBTOPICS)[number]>(SUBTOPICS.map((s) => [s.id, s]));

export function topicName(id: string): string {
  return NAMES.get(id) ?? "Other";
}

export function isTopicId(id: string): id is TopicId {
  return NAMES.has(id);
}

export function isSubtopicId(id: string): id is SubtopicId {
  return SUBS.has(id);
}

export function isInterestId(id: string): id is InterestId {
  return isTopicId(id) || isSubtopicId(id);
}

export function subtopicName(id: string | null | undefined): string | null {
  return (id && SUBS.get(id)?.name) ?? null;
}

/** The section a subtopic belongs to. */
export function sectionOf(id: SubtopicId): TopicId {
  return SUBS.get(id)!.section;
}

/** A section's or subtopic's display name, or null for an unknown id. */
export function interestName(id: string): string | null {
  return NAMES.get(id) ?? subtopicName(id);
}

export function subtopicsOf(section: TopicId): (typeof SUBTOPICS)[number][] {
  return SUBTOPICS.filter((s) => s.section === section);
}

/** `raw` as a subtopic of `section`, or null when it isn't one (unknown, or under another section). */
export function subtopicUnder(section: string | null | undefined, raw: unknown): SubtopicId | null {
  if (typeof raw !== "string" || !section) return null;
  const sub = SUBS.get(raw);
  return sub && sub.section === section ? sub.id : null;
}
