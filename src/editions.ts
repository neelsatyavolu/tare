import type { BuiltStory } from "./build/build";
import type { Coverage } from "./build/select";
import { outletById, type Outlet } from "./outlets";
import { isTopicId } from "./topics";

export type Edition = { date: string; number: number; status: "building" | "ready" | "failed"; itemCount: number; builtAt: number | null; sentAt: number | null };
export type Story = Omit<BuiltStory, "coverage"> & { editionDate: string; coverage: Coverage };
export type Source = { id: string; outlet: Outlet; title: string; url: string; publishedAt: number; imageUrl: string | null };

type EditionRow = { date: string; number: number; status: Edition["status"]; item_count: number; built_at: number | null; sent_at: number | null };
type StoryRow = {
  id: string; edition_date: string; rank: number; front: number; topic: string; headline: string;
  summary: string; differences: string; coverage: string; blindspot: "left" | "right" | null; item_ids: string; image_item_id: string | null;
};

const toEdition = (r: EditionRow): Edition => ({ date: r.date, number: r.number, status: r.status, itemCount: r.item_count, builtAt: r.built_at, sentAt: r.sent_at });

const toStory = (r: StoryRow): Story => ({
  id: r.id,
  editionDate: r.edition_date,
  rank: r.rank,
  front: r.front === 1,
  topic: isTopicId(r.topic) ? r.topic : "world",
  headline: r.headline,
  summary: JSON.parse(r.summary),
  differences: JSON.parse(r.differences),
  coverage: JSON.parse(r.coverage),
  blindspot: r.blindspot,
  itemIds: JSON.parse(r.item_ids),
  imageItemId: r.image_item_id,
});

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
  const { results } = await db.prepare("SELECT * FROM stories WHERE edition_date = ? ORDER BY rank").bind(date).all<StoryRow>();
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
      .prepare(`SELECT id, outlet_id, title, url, published_at, image_url FROM items WHERE id IN (${chunk.map(() => "?").join(",")})`)
      .bind(...chunk)
      .all<{ id: string; outlet_id: string; title: string; url: string; published_at: number; image_url: string | null }>();
    for (const r of results) {
      const outlet = outletById(r.outlet_id);
      if (outlet) out.set(r.id, { id: r.id, outlet, title: r.title, url: r.url, publishedAt: r.published_at, imageUrl: r.image_url });
    }
  }
  return out;
}
