import type { BuiltStory } from "./build/build";
import type { Coverage } from "./build/select";
import { outletById, sideOf, type Outlet, type Side } from "./outlets";
import { isTopicId, subtopicUnder } from "./topics";

export type Edition = { date: string; number: number; status: "building" | "ready" | "failed"; itemCount: number; builtAt: number | null; sentAt: number | null };
export type Story = Omit<BuiltStory, "coverage"> & {
  editionDate: string; coverage: Coverage; firstSeenAt: number | null; writtenAt: number | null;
  /** Set by the editor when a published story was corrected; shown, dated, on its page. */
  correction?: { note: string; at: number } | null;
};
export type Source = { id: string; outlet: Outlet; title: string; url: string; publishedAt: number; imageUrl: string | null; snippet?: string };

type EditionRow = { date: string; number: number; status: Edition["status"]; item_count: number; built_at: number | null; sent_at: number | null };
type StoryRow = {
  id: string; edition_date: string; rank: number; front: number; topic: string; subtopic?: string | null; headline: string;
  summary: string; differences: string; coverage: string; blindspot: "left" | "right" | null; item_ids: string; image_item_id: string | null; first_seen_at: number | null; importance: number | null;
  dek: string | null; why: string | null; written_at: number | null; correction_note?: string | null; corrected_at?: number | null;
};

const toEdition = (r: EditionRow): Edition => ({ date: r.date, number: r.number, status: r.status, itemCount: r.item_count, builtAt: r.built_at, sentAt: r.sent_at });

const toStory = (r: StoryRow): Story => {
  const topic = isTopicId(r.topic) ? r.topic : "world";
  return {
    id: r.id,
    editionDate: r.edition_date,
    rank: r.rank,
    front: r.front === 1,
    topic,
    subtopic: subtopicUnder(topic, r.subtopic),
    headline: r.headline,
    dek: r.dek ? JSON.parse(r.dek) : null,
    why: r.why ? JSON.parse(r.why) : null,
    summary: JSON.parse(r.summary),
    differences: JSON.parse(r.differences),
    coverage: JSON.parse(r.coverage),
    blindspot: r.blindspot,
    itemIds: JSON.parse(r.item_ids),
    imageItemId: r.image_item_id,
    firstSeenAt: r.first_seen_at,
    writtenAt: r.written_at,
    importance: r.importance,
    correction: r.correction_note && r.corrected_at ? { note: r.correction_note, at: r.corrected_at } : null,
  };
};

/** Records the editor's correction note on a story; the story's text is fixed separately (a rewrite, or removal). */
export async function setCorrection(db: D1Database, storyId: string, note: string, now: number): Promise<boolean> {
  const r = await db.prepare("UPDATE stories SET correction_note = ?, corrected_at = ? WHERE id = ?").bind(note, now, storyId).run();
  return (r.meta.changes ?? 0) > 0;
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function latestEdition(db: D1Database): Promise<Edition | null> {
  const r = await db.prepare("SELECT * FROM editions WHERE status = 'ready' ORDER BY date DESC LIMIT 1").first<EditionRow>();
  return r ? toEdition(r) : null;
}

export async function editionByDate(db: D1Database, date: string): Promise<Edition | null> {
  if (!DATE_RE.test(date)) return null;
  const r = await db.prepare("SELECT * FROM editions WHERE date = ? AND status = 'ready'").bind(date).first<EditionRow>();
  return r ? toEdition(r) : null;
}

export async function listEditions(db: D1Database, limit = 60): Promise<(Edition & { stories: number })[]> {
  const { results } = await db
    .prepare(
      `SELECT e.*, (SELECT COUNT(*) FROM stories s WHERE s.edition_date = e.date) AS stories
       FROM editions e WHERE e.status = 'ready' ORDER BY e.date DESC LIMIT ?`,
    )
    .bind(limit)
    .all<EditionRow & { stories: number }>();
  return results.map((r) => ({ ...toEdition(r), stories: r.stories }));
}

export async function storiesFor(db: D1Database, date: string): Promise<Story[]> {
  // The current lineup only; stories that dropped out stay reachable by link.
  const { results } = await db.prepare("SELECT * FROM stories WHERE edition_date = ? AND active = 1 ORDER BY rank").bind(date).all<StoryRow>();
  return results.map(toStory);
}

export async function storyById(db: D1Database, id: string): Promise<Story | null> {
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  const r = await db.prepare("SELECT * FROM stories WHERE id = ?").bind(id).first<StoryRow>();
  return r ? toStory(r) : null;
}

/** The headlines behind a set of stories, keyed by item id. */
export async function sourcesFor(db: D1Database, stories: readonly Story[]): Promise<Map<string, Source>> {
  const ids = [...new Set(stories.flatMap((s) => s.itemIds))];
  const out = new Map<string, Source>();
  // D1 caps bound parameters per statement at 100.
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const { results } = await db
      .prepare(`SELECT id, outlet_id, title, url, published_at, image_url, snippet FROM items WHERE id IN (${chunk.map(() => "?").join(",")})`)
      .bind(...chunk)
      .all<{ id: string; outlet_id: string; title: string; url: string; published_at: number; image_url: string | null; snippet: string }>();
    for (const r of results) {
      const outlet = outletById(r.outlet_id);
      if (outlet) out.set(r.id, { id: r.id, outlet, title: r.title, url: r.url, publishedAt: r.published_at, imageUrl: r.image_url, snippet: r.snippet || undefined });
    }
  }
  return out;
}

/** A sentence that says no more than the headline (the write-up's last-resort opening). */
export const restatesHeadline = (s: Story, text: string) => {
  const same = (a: string) => a.toLowerCase().replace(/[^a-z0-9]/g, "");
  return same(text) === same(s.headline);
};

/** The summary as shown under its headline: a sentence that only restates the headline is left out when others remain. */
export function shownSummary(s: Story): Story["summary"] {
  const rest = s.summary.filter((x) => !restatesHeadline(s, x.text));
  return rest.length > 0 ? rest : s.summary;
}

/** A slip like "Starlink and Starlink speeds": the same word on both sides of "and"/"or". */
export const DOUBLED = /\b([A-Z][\w'-]+) (?:and|or) \1\b/;

/** A sentence that reads as a follow-on to something not shown ("have also intervened", "defended the same ad"). */
export const CONTINUATION = /\b(also|the same|had earlier|meanwhile|separately|as well|in response)\b/i;

/**
 * The one line a story card shows, on the site and in the email alike: the checked dek, or the first summary
 * sentence. When that line only restates the headline, the card shows the next sentence that stands on its own,
 * or nothing: a follow-on would read as the event.
 */
export function cardLine(s: Story): string {
  const dek = s.dek && !DOUBLED.test(s.dek.text) ? s.dek : null;
  const line = (dek ?? s.summary[0])?.text ?? "";
  if (!restatesHeadline(s, line)) return line;
  return s.summary.find((x) => !restatesHeadline(s, x.text) && !CONTINUATION.test(x.text))?.text ?? "";
}

/** A story's sources in display order (left, center, right, then by outlet), which fixes the citation numbers. */
export function orderedSources(story: Story, sources: Map<string, Source>): Source[] {
  const order: Record<Side, number> = { left: 0, center: 1, right: 2 };
  // Unrated outlets come last.
  const rank = (s: Source) => {
    const side = sideOf(s.outlet.lean);
    return side ? order[side] : 3;
  };
  return story.itemIds
    .map((id) => sources.get(id))
    .filter((s): s is Source => !!s)
    .sort((a, b) => rank(a) - rank(b) || a.outlet.name.localeCompare(b.outlet.name));
}

