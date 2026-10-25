import { mapLimit, sha256Hex, utcDate } from "../util";
import { clusterItems, normalize, type Embedded } from "./cluster";
import { classifyGroups } from "./classify";
import { blindspotOf, coverageOf, frontPage, pickBalanced, rankGroups, SECTION_MIN_OUTLETS, type Blindspot, type Coverage } from "./select";
import { summarize, type AiRunner, type Difference, type Cited, type SourceItem } from "./summarize";
import type { TopicId } from "../topics";
import { outletById, sideOf, type Side } from "../outlets";

export const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";
/**
 * Cosine similarity (headline + description, bge-base) at which two items count as the same event.
 * Tuned on the 2026-10-25 feeds: 0.80 chained a day of U.S. election coverage into one 57-item group; 0.84 kept events apart.
 */
export const SAME_EVENT = 0.84;
const WINDOW_MS = 24 * 3600_000;
const MIN_ITEMS = 40;
/** Groups sent to the section classifier; the rest are too thinly covered to make the edition. */
const CLASSIFY_LIMIT = 120;
const FRONT_SIZE = 6;
const CONCURRENCY = 4;

type ItemRow = { id: string; outlet_id: string; title: string; snippet: string; published_at: number; image_url: string | null };
type Member = Embedded & SourceItem & { imageUrl: string | null };

export type BuiltStory = {
  id: string;
  rank: number;
  front: boolean;
  topic: TopicId;
  headline: string;
  summary: Cited[];
  differences: Difference[];
  coverage: Coverage;
  blindspot: Blindspot;
  itemIds: string[];
  imageItemId: string | null;
};

export type BuildReport = { date: string; status: "ready" | "failed" | "skipped"; items: number; candidates: number; stories: number; error?: string };

async function embed(ai: AiRunner, texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const res = (await ai.run(EMBED_MODEL, { text: texts.slice(i, i + 100) })) as { data?: number[][] };
    if (!Array.isArray(res?.data) || res.data.length !== Math.min(100, texts.length - i)) throw new Error("embedding reply had the wrong shape");
    out.push(...res.data);
  }
  return out;
}

/** One outlet can file several pieces on the same event; the write-up gets its most recent one. */
function onePerOutlet(members: Member[]): Member[] {
  const latest = new Map<string, Member>();
  for (const m of members) {
    const prev = latest.get(m.outletId);
    if (!prev || m.publishedAt > prev.publishedAt) latest.set(m.outletId, m);
  }
  return [...latest.values()].sort((a, b) => a.outletId.localeCompare(b.outletId));
}

/**
 * The photo a story shows. A photo frames a story as much as a headline, so it comes from a center outlet
 * when one has a picture, then from whichever side covered the story less, so the larger side doesn't
 * also get to pick the image. Ties go by outlet id, which keeps it deterministic.
 */
export function pickImage(sources: readonly { id: string; outletId: string; imageUrl: string | null }[]): string | null {
  const withImage = sources.filter((s) => s.imageUrl);
  if (withImage.length === 0) return null;
  const sideCount = (side: Side) => sources.filter((s) => sideOfOutlet(s.outletId) === side).length;
  const minority: Side = sideCount("left") <= sideCount("right") ? "left" : "right";
  const rank = (s: { outletId: string }) => ({ center: 0, [minority]: 1 } as Record<string, number>)[sideOfOutlet(s.outletId)] ?? 2;
  return [...withImage].sort((a, b) => rank(a) - rank(b) || a.outletId.localeCompare(b.outletId))[0]!.id;
}

function sideOfOutlet(id: string): Side | "unknown" {
  const o = outletById(id);
  return o ? sideOf(o.lean) : "unknown";
}

async function writeStories(ai: AiRunner, picked: { members: Member[]; topic: TopicId | null }[], date: string): Promise<BuiltStory[]> {
  const written = await mapLimit(picked, CONCURRENCY, async ({ members: group, topic }) => {
    const sources = onePerOutlet(group);
    try {
      const w = await summarize(ai, sources);
      if (!w) return null;
      const kept = sources.filter((s) => !w.offTopic.includes(s.id));
      const coverage = coverageOf(kept.map((s) => s.outletId));
      if (coverage.total < SECTION_MIN_OUTLETS) return null;
      const story: Omit<BuiltStory, "rank" | "front"> = {
        id: await sha256Hex(`${date}:${kept.map((s) => s.id).join(",")}`),
        // The section decided before selection wins, so a story stays in the section it was picked for.
        topic: topic ?? w.topic,
        headline: w.headline,
        summary: w.summary,
        differences: w.differences,
        coverage,
        blindspot: blindspotOf(coverage),
        itemIds: kept.map((s) => s.id),
        imageItemId: pickImage(kept),
      };
      return story;
    } catch (err) {
      console.error(`summary failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  });

  const stories = written.filter((s): s is NonNullable<typeof s> => s !== null);
  const front = frontPage(stories, FRONT_SIZE);
  // Front page first, then everything else, each by breadth of coverage.
  return [...stories]
    .sort((a, b) => Number(front.has(b)) - Number(front.has(a)) || b.coverage.total - a.coverage.total)
    .map((s, rank) => ({ ...s, rank, front: front.has(s) }));
}

/** Builds today's edition from the last 24 hours of headlines. Re-running replaces the day's stories. */
export async function buildEdition(db: D1Database, ai: AiRunner, now = Date.now(), opts: { force?: boolean } = {}): Promise<BuildReport> {
  const date = utcDate(now);
  const existing = await db
    .prepare("SELECT number, status, sent_at FROM editions WHERE date = ?")
    .bind(date)
    .first<{ number: number; status: string; sent_at: number | null }>();
  // Once emails have gone out, their story links must keep working, so a sent edition is never rebuilt.
  if (existing?.sent_at != null || (existing?.status === "ready" && !opts.force)) return { date, status: "skipped", items: 0, candidates: 0, stories: 0 };

  const number = existing?.number ?? ((await db.prepare("SELECT COUNT(*) AS n FROM editions").first<{ n: number }>())?.n ?? 0) + 1;
  await db
    .prepare("INSERT INTO editions (date, number, status) VALUES (?, ?, 'building') ON CONFLICT(date) DO UPDATE SET status = 'building', error = NULL")
    .bind(date, number)
    .run();

  let report: BuildReport = { date, status: "failed", items: 0, candidates: 0, stories: 0 };
  try {
    const { results } = await db
      .prepare("SELECT id, outlet_id, title, snippet, published_at, image_url FROM items WHERE published_at > ? AND published_at <= ?")
      .bind(now - WINDOW_MS, now)
      .all<ItemRow>();
    report = { ...report, items: results.length };
    if (results.length < MIN_ITEMS) throw new Error(`only ${results.length} headlines in the last 24 hours`);

    const vectors = await embed(ai, results.map((r) => `${r.title}. ${r.snippet}`.slice(0, 600)));
    const members: Member[] = results.map((r, i) => ({
      id: r.id,
      outletId: r.outlet_id,
      publishedAt: r.published_at,
      title: r.title,
      snippet: r.snippet,
      imageUrl: r.image_url,
      vec: normalize(vectors[i]!),
    }));

    const ranked = rankGroups(clusterItems(members, SAME_EVENT)).slice(0, CLASSIFY_LIMIT);
    const topics = await classifyGroups(ai, ranked.map((c) => c.members));
    const candidates = pickBalanced(ranked.map((c, i) => ({ ...c, topic: topics[i] ?? null })));
    report = { ...report, candidates: candidates.length };
    const stories = await writeStories(ai, candidates, date);
    if (stories.length === 0) throw new Error("no story survived the write-up checks");

    const insert = db.prepare(
      `INSERT INTO stories (id, edition_date, rank, front, topic, headline, summary, differences, coverage, blindspot, item_ids, image_item_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    await db.batch([
      db.prepare("DELETE FROM stories WHERE edition_date = ?").bind(date),
      ...stories.map((s) =>
        insert.bind(s.id, date, s.rank, s.front ? 1 : 0, s.topic, s.headline, JSON.stringify(s.summary), JSON.stringify(s.differences), JSON.stringify(s.coverage), s.blindspot, JSON.stringify(s.itemIds), s.imageItemId),
      ),
      db.prepare("UPDATE editions SET status = 'ready', item_count = ?, built_at = ?, error = NULL WHERE date = ?").bind(results.length, now, date),
    ]);
    return { ...report, status: "ready", stories: stories.length };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`edition ${date} failed: ${error}`);
    // Keep a previously built edition readable if a forced rebuild fails.
    const status = existing?.status === "ready" ? "ready" : "failed";
    await db.prepare("UPDATE editions SET status = ?, error = ? WHERE date = ?").bind(status, error, date).run();
    return { ...report, status: "failed", error };
  }
}
