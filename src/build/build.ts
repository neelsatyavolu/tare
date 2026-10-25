import type { TopicId } from "../topics";
import { mapLimit, sha256Hex, utcDate } from "../util";
import { classifyGroups, CLASSIFY_VERSION, type Classification } from "./classify";
import { clusterItems, dot, normalize, type Embedded } from "./cluster";
import { outletById, sideOf } from "../outlets";
import { decodeVector, embedPending } from "./embed";
import { matchStories, needsRewrite } from "./match";
import { pickImage } from "./photos";
import { blindspotOf, byWeight, coverageOf, frontPage, pickBalanced, rankGroups, SECTION_MIN_OUTLETS, type Blindspot, type Candidate, type Coverage } from "./select";
import { summarize, WRITEUP_VERSION, type AiRunner, type Cited, type Difference, type SourceItem } from "./summarize";

export { pickImage } from "./photos";
export { EMBED_MODEL } from "./embed";

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
/** New write-ups per run. The first run of the day uses most of it; later runs only write up new events. */
const WRITE_BUDGET = 32;
const LOCK_MS = 14 * 60_000;

type ItemRow = { id: string; outlet_id: string; title: string; snippet: string; published_at: number; image_url: string | null; embedding: unknown; topic: string | null; importance: number | null; classify_version: number };
type Member = Embedded & SourceItem & { imageUrl: string | null; topic: string | null; importance: number | null };
type Picked = Candidate<Member> & { topic: TopicId | null; importance: number | null };

export type BuiltStory = {
  id: string;
  rank: number;
  front: boolean;
  topic: TopicId;
  headline: string;
  dek: Cited | null;
  why: Cited | null;
  summary: Cited[];
  differences: Difference[];
  coverage: Coverage;
  blindspot: Blindspot;
  itemIds: string[];
  imageItemId: string | null;
  importance: number | null;
};

type ExistingRow = {
  id: string; topic: TopicId; headline: string; summary: string; differences: string; item_ids: string; dek: string | null; why: string | null;
  image_item_id: string | null; written_total: number | null; first_seen_at: number | null; importance: number | null;
  writeup_version: number;
};

/** One row to save: a story in this hour's lineup. */
type LineupStory = Omit<BuiltStory, "rank" | "front"> & { writtenTotal: number; firstSeenAt: number; writeupVersion: number };

export type BuildReport = {
  date: string; status: "ready" | "failed" | "skipped"; items: number; candidates: number; stories: number;
  written: number; kept: number; error?: string;
};

/** One outlet can file several pieces on the same event; the write-up gets its most recent one. */
function onePerOutlet(members: readonly Member[]): Member[] {
  const latest = new Map<string, Member>();
  for (const m of members) {
    const prev = latest.get(m.outletId);
    if (!prev || m.publishedAt > prev.publishedAt) latest.set(m.outletId, m);
  }
  return [...latest.values()].sort((a, b) => a.outletId.localeCompare(b.outletId));
}

/** The section each group belongs to: remembered from earlier runs when most of its items have one, else classified now. */
/** The most common non-null value among a group's members, if at least half of them have it. */
function majority<V>(values: readonly (V | null)[]): V | null {
  const counts = new Map<V, number>();
  for (const v of values) if (v != null) counts.set(v, (counts.get(v) ?? 0) + 1);
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return best && best[1] * 2 >= values.length ? best[0] : null;
}

/**
 * Each group's section and importance: remembered from earlier runs when most of its items have them,
 * else classified now (and remembered on the items for next time).
 */
async function sections(db: D1Database, ai: AiRunner, groups: readonly Candidate<Member>[]): Promise<Classification[]> {
  const known: Classification[] = groups.map((g) => ({
    topic: majority(g.members.map((m) => m.topic)) as TopicId | null,
    importance: majority(g.members.map((m) => m.importance)),
  }));
  const unknown = groups.map((g, i) => ({ g, i })).filter(({ i }) => known[i]!.topic === null || known[i]!.importance === null);
  const fresh = unknown.length ? await classifyGroups(ai, unknown.map(({ g }) => g.members)) : [];

  const stmt = db.prepare("UPDATE items SET topic = COALESCE(?, topic), importance = COALESCE(?, importance), classify_version = ? WHERE id = ?");
  const writes: D1PreparedStatement[] = [];
  unknown.forEach(({ g, i }, k) => {
    const c = fresh[k] ?? { topic: null, importance: null };
    known[i] = { topic: c.topic ?? known[i]!.topic, importance: c.importance ?? known[i]!.importance };
    if (c.topic || c.importance) for (const m of g.members) writes.push(stmt.bind(c.topic, c.importance, CLASSIFY_VERSION, m.id));
  });
  for (let i = 0; i < writes.length; i += 100) await db.batch(writes.slice(i, i + 100));
  return known;
}

async function writeUp(ai: AiRunner, group: Picked, date: string, now: number): Promise<LineupStory | null> {
  const sources = onePerOutlet(group.members);
  try {
    const w = await summarize(ai, sources, now);
    if (!w) return null;
    const kept = sources.filter((s) => !w.offTopic.includes(s.id));
    const coverage = coverageOf(kept.map((s) => s.outletId));
    if (coverage.total < SECTION_MIN_OUTLETS) return null;
    return {
      id: await sha256Hex(`${date}:${kept.map((s) => s.id).join(",")}`),
      // The section decided before selection wins, so a story stays in the section it was picked for.
      topic: group.topic ?? w.topic,
      headline: w.headline,
      dek: w.dek,
      why: w.why,
      summary: w.summary,
      differences: w.differences,
      coverage,
      blindspot: blindspotOf(coverage),
      itemIds: kept.map((s) => s.id),
      imageItemId: pickImage(kept),
      importance: group.importance,
      writtenTotal: coverage.total,
      writeupVersion: WRITEUP_VERSION,
      firstSeenAt: now,
    };
  } catch (err) {
    console.error(`summary failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** A continuing story: same id, same write-up, its coverage widened by this hour's new items. */
function carryOver(ex: ExistingRow, group: Picked, outletOf: ReadonlyMap<string, string>, now: number): LineupStory {
  const exIds: string[] = JSON.parse(ex.item_ids);
  const added = onePerOutlet(group.members).filter((m) => !exIds.includes(m.id));
  const itemIds = [...exIds, ...added.map((m) => m.id)];
  const coverage = coverageOf(itemIds.map((id) => outletOf.get(id)).filter((o): o is string => !!o));
  return {
    id: ex.id,
    topic: ex.topic,
    headline: ex.headline,
    dek: ex.dek ? JSON.parse(ex.dek) : null,
    why: ex.why ? JSON.parse(ex.why) : null,
    summary: JSON.parse(ex.summary),
    differences: JSON.parse(ex.differences),
    coverage,
    blindspot: blindspotOf(coverage),
    itemIds,
    imageItemId: ex.image_item_id ?? pickImage(onePerOutlet(group.members)),
    importance: group.importance ?? ex.importance,
    writeupVersion: ex.writeup_version,
    writtenTotal: ex.written_total ?? coverage.total,
    firstSeenAt: ex.first_seen_at ?? now,
  };
}

/** Looser than SAME_EVENT, used only to double-check a blindspot: any headline this close from the skipping side clears it. */
export const BLINDSPOT_CHECK = 0.76;

/**
 * Confirms a blindspot against everything the "skipping" side published in the window, not just the items
 * that clustered: if any of its headlines is close to the story, the side did cover it and it isn't one.
 */
export function checkBlindspot<S extends { blindspot: Blindspot }>(story: S, group: { members: readonly Embedded[] }, all: readonly Embedded[]): S {
  if (!story.blindspot || group.members.length === 0) return story;
  const dims = group.members[0]!.vec.length;
  const centroid = normalize(group.members.reduce((acc, m) => acc.map((x, k) => x + m.vec[k]!), new Array<number>(dims).fill(0)));
  const side = story.blindspot;
  const covered = all.some((m) => {
    const o = outletById(m.outletId);
    return !!o && sideOf(o.lean) === side && dot(m.vec, centroid) >= BLINDSPOT_CHECK;
  });
  return covered ? { ...story, blindspot: null } : story;
}

/** Outlet of every item this run touches: this window's items plus older ones existing stories still cite. */
async function outletsOf(db: D1Database, window: readonly ItemRow[], existing: readonly ExistingRow[]): Promise<Map<string, string>> {
  const map = new Map(window.map((r) => [r.id, r.outlet_id]));
  const missing = [...new Set(existing.flatMap((e) => JSON.parse(e.item_ids) as string[]))].filter((id) => !map.has(id));
  for (let i = 0; i < missing.length; i += 90) {
    const chunk = missing.slice(i, i + 90);
    const { results } = await db
      .prepare(`SELECT id, outlet_id FROM items WHERE id IN (${chunk.map(() => "?").join(",")})`)
      .bind(...chunk)
      .all<{ id: string; outlet_id: string }>();
    for (const r of results) map.set(r.id, r.outlet_id);
  }
  return map;
}

/** Claims the edition for this run. Returns false while another run holds it. */
async function lock(db: D1Database, date: string, now: number): Promise<boolean> {
  const number = ((await db.prepare("SELECT COUNT(*) AS n FROM editions").first<{ n: number }>())?.n ?? 0) + 1;
  await db.prepare("INSERT INTO editions (date, number, status) VALUES (?, ?, 'building') ON CONFLICT(date) DO NOTHING").bind(date, number).run();
  const r = await db
    .prepare("UPDATE editions SET lock_until = ? WHERE date = ? AND (lock_until IS NULL OR lock_until < ?)")
    .bind(now + LOCK_MS, date, now)
    .run();
  return (r.meta.changes ?? 0) === 1;
}

/**
 * Refreshes today's edition from the last 24 hours of headlines. Runs every hour: continuing stories keep
 * their id and write-up (rewritten only when coverage grows a lot), new events are written up, and stories
 * that drop out stay in the database, inactive, so links to them keep working.
 */
export async function buildEdition(db: D1Database, ai: AiRunner, now = Date.now(), opts: { force?: boolean } = {}): Promise<BuildReport> {
  const date = utcDate(now);
  const empty = { date, items: 0, candidates: 0, stories: 0, written: 0, kept: 0 };
  if (!(await lock(db, date, now))) return { ...empty, status: "skipped", error: "another build is running" };

  let report: BuildReport = { ...empty, status: "failed" };
  try {
    await embedPending(db, ai, now - WINDOW_MS);
    const { results } = await db
      .prepare(
        `SELECT id, outlet_id, title, snippet, published_at, image_url, embedding, topic, importance, classify_version FROM items
         WHERE published_at > ? AND published_at <= ? AND embedding IS NOT NULL`,
      )
      .bind(now - WINDOW_MS, now)
      .all<ItemRow>();
    report = { ...report, items: results.length };
    if (results.length < MIN_ITEMS) throw new Error(`only ${results.length} headlines in the last 24 hours`);

    const members: Member[] = results.flatMap((r) => {
      const vec = decodeVector(r.embedding);
      // Ratings made under older rules are forgotten, so the group is classified again.
      const current = r.classify_version >= CLASSIFY_VERSION;
      return vec ? [{ id: r.id, outletId: r.outlet_id, publishedAt: r.published_at, title: r.title, snippet: r.snippet, imageUrl: r.image_url, topic: current ? r.topic : null, importance: current ? r.importance : null, vec }] : [];
    });
    const ranked = rankGroups(clusterItems(members, SAME_EVENT)).slice(0, CLASSIFY_LIMIT);
    const topics = await sections(db, ai, ranked);
    const picked: Picked[] = pickBalanced(ranked.map((c, i) => ({ ...c, topic: topics[i]?.topic ?? null, importance: topics[i]?.importance ?? null })));
    report = { ...report, candidates: picked.length };

    const { results: existing } = await db
      .prepare("SELECT id, topic, headline, summary, differences, item_ids, dek, why, image_item_id, written_total, first_seen_at, importance, writeup_version FROM stories WHERE edition_date = ?")
      .bind(date)
      .all<ExistingRow>();
    const outletOf = await outletsOf(db, results, existing);
    const matches = matchStories(picked.map((p) => p.members.map((m) => m.id)), existing.map((e) => JSON.parse(e.item_ids) as string[]));

    let budget = WRITE_BUDGET;
    const lineup = await mapLimit(picked, CONCURRENCY, async (group, i) => {
      const ex = matches[i]! >= 0 ? existing[matches[i]!]! : null;
      const carried = ex ? carryOver(ex, group, outletOf, now) : null;
      const outdated = !!ex && ex.writeup_version < WRITEUP_VERSION;
      const rewrite = !carried || opts.force || outdated || needsRewrite(carried.writtenTotal, carried.coverage.total);
      if (!rewrite || budget <= 0) return carried && checkBlindspot(carried, group, members);
      budget -= 1;
      const fresh = await writeUp(ai, group, date, now);
      // A rewrite keeps the story's id and first-seen time, so its link and "new" marker don't change. Its sources
      // are the fresh write-up's, so the source list always matches the counts.
      const story = fresh && carried ? { ...fresh, id: carried.id, firstSeenAt: carried.firstSeenAt } : (fresh ?? carried);
      return story && checkBlindspot(story, group, members);
    });

    const stories = [...new Map(lineup.filter((s): s is LineupStory => s !== null).map((s) => [s.id, s])).values()];
    if (stories.length === 0 && existing.length === 0) throw new Error("no story survived the write-up checks");
    if (stories.length === 0) throw new Error("no story this hour; keeping the previous lineup");

    const front = frontPage(stories, FRONT_SIZE);
    const ordered = [...stories].sort((a, b) => Number(front.has(b)) - Number(front.has(a)) || byWeight(a, b));
    const upsert = db.prepare(
      `INSERT INTO stories (id, edition_date, rank, front, topic, headline, summary, differences, coverage, blindspot, item_ids, image_item_id,
                            active, first_seen_at, updated_at, written_total, importance, writeup_version, dek, why)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET rank = excluded.rank, front = excluded.front, topic = excluded.topic, headline = excluded.headline,
         summary = excluded.summary, differences = excluded.differences, coverage = excluded.coverage, blindspot = excluded.blindspot,
         item_ids = excluded.item_ids, image_item_id = excluded.image_item_id, active = 1, updated_at = excluded.updated_at,
         written_total = excluded.written_total, importance = excluded.importance, writeup_version = excluded.writeup_version,
         dek = excluded.dek, why = excluded.why`,
    );
    const live = new Set(ordered.map((s) => s.id));
    const retire = db.prepare("UPDATE stories SET active = 0, front = 0 WHERE id = ?");
    await db.batch([
      ...ordered.map((s, rank) =>
        upsert.bind(
          s.id, date, rank, front.has(s) ? 1 : 0, s.topic, s.headline, JSON.stringify(s.summary), JSON.stringify(s.differences),
          JSON.stringify(s.coverage), s.blindspot, JSON.stringify(s.itemIds), s.imageItemId, s.firstSeenAt, now, s.writtenTotal, s.importance, s.writeupVersion,
          s.dek ? JSON.stringify(s.dek) : null, s.why ? JSON.stringify(s.why) : null,
        ),
      ),
      ...existing.filter((e) => !live.has(e.id)).map((e) => retire.bind(e.id)),
      db.prepare("UPDATE editions SET status = 'ready', item_count = ?, built_at = ?, error = NULL, lock_until = NULL WHERE date = ?").bind(results.length, now, date),
    ]);
    const kept = ordered.filter((s) => existing.some((e) => e.id === s.id)).length;
    return { ...report, status: "ready", stories: ordered.length, written: WRITE_BUDGET - budget, kept };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`edition ${date} failed: ${error}`);
    // An edition that has been ready stays readable with its last lineup.
    await db
      .prepare("UPDATE editions SET status = CASE WHEN status = 'ready' THEN 'ready' ELSE 'failed' END, error = ?, lock_until = NULL WHERE date = ?")
      .bind(error, date)
      .run();
    return { ...report, status: "failed", error };
  }
}
