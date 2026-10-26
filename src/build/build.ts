import { subtopicUnder, type SubtopicId, type TopicId } from "../topics";
import { mapLimit, sha256Hex, utcDate } from "../util";
import { classifyGroups, CLASSIFY_VERSION, type Classification } from "./classify";
import { clusterItems, dot, normalize, type Embedded } from "./cluster";
import { outletById, sideOf } from "../outlets";
import { decodeVector, embedPending } from "./embed";
import { matchStories, needsRewrite } from "./match";
import { pickImage } from "./photos";
import { withRateLimitRetry } from "./ai-retry";
import { blindspotOf, coverageOf, freshness, frontOrder, frontPage, pickBalanced, rankGroups, SECTION_MIN_OUTLETS, sectionOrder, type Blindspot, type Candidate, type Coverage } from "./select";
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
/**
 * Groups sent to the section classifier; the rest are too thinly covered to make the edition. Room for 160 so
 * technology and AI stories, which fewer outlets carry, still get sorted into their sections.
 */
const CLASSIFY_LIMIT = 160;
const FRONT_SIZE = 6;
/** Write-ups at a time; 10 tripped Workers AI's per-minute request limit for the write-up model. */
const CONCURRENCY = 6;
/** New write-ups per run. The first run of the day uses most of it; later runs only write up new events. */
const WRITE_BUDGET = 48;
const LOCK_MS = 14 * 60_000;
/** No new rewrites start after this long, so a build finishes inside the 15-minute cron limit; the rest wait an hour. */
/** A cron run gets 15 minutes; the build must save before then (a killed build saves nothing). */
export const RUN_BUDGET_MS = 13 * 60_000;
/** No new rewrite starts later than this before the run's deadline (a rewrite with retries can take minutes). */
const LAST_START_BEFORE_MS = 6 * 60_000;
/** A rewrite still running this long before the deadline is abandoned; its story keeps the published version. */
const HARD_STOP_BEFORE_MS = 90_000;

type ItemRow = { id: string; outlet_id: string; title: string; snippet: string; published_at: number; image_url: string | null; embedding: unknown; topic: string | null; subtopic: string | null; importance: number | null; classify_version: number };
export type Member = Embedded & SourceItem & { imageUrl: string | null; topic: string | null; subtopic: string | null; importance: number | null };
type Picked = Candidate<Member> & { topic: TopicId | null; subtopic: SubtopicId | null; importance: number | null };

export type BuiltStory = {
  id: string;
  rank: number;
  front: boolean;
  topic: TopicId;
  /** A narrower topic within `topic` (see SUBTOPICS), when the classifier found one. */
  subtopic: SubtopicId | null;
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
  id: string; topic: TopicId; subtopic: string | null; headline: string; summary: string; differences: string; item_ids: string; dek: string | null; why: string | null;
  image_item_id: string | null; written_total: number | null; first_seen_at: number | null; importance: number | null;
  writeup_version: number; written_at: number | null;
};

/** One row to save: a story in this hour's lineup. */
type LineupStory = Omit<BuiltStory, "rank" | "front"> & { writtenTotal: number; firstSeenAt: number; writeupVersion: number; writtenAt: number | null; flagged?: boolean };

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
/** Groups per classification call; chunks run CLASSIFY_CONCURRENCY at a time and each is saved as soon as it's back. */
const CLASSIFY_CHUNK = 40;
const CLASSIFY_CONCURRENCY = 4;

/**
 * Section and importance for each group: remembered ratings first, then the model for the rest. Ratings are saved
 * chunk by chunk, so a run that runs out of time keeps what it rated and the next hour carries on from there;
 * chunks not started by `stopAt` wait an hour (their groups rank as minor meanwhile).
 */
export async function sections(db: D1Database, ai: AiRunner, groups: readonly Candidate<Member>[], stopAt: number): Promise<Classification[]> {
  const known: Classification[] = groups.map((g) => {
    const topic = majority(g.members.map((m) => m.topic)) as TopicId | null;
    return { topic, subtopic: subtopicUnder(topic, majority(g.members.map((m) => m.subtopic))), importance: majority(g.members.map((m) => m.importance)) };
  });
  const unknown = groups.map((g, i) => ({ g, i })).filter(({ i }) => known[i]!.topic === null || known[i]!.importance === null);
  const chunks = Array.from({ length: Math.ceil(unknown.length / CLASSIFY_CHUNK) }, (_, k) => unknown.slice(k * CLASSIFY_CHUNK, (k + 1) * CLASSIFY_CHUNK));
  // A subtopic is saved whenever a section is: null then means "none fits", not "not rated".
  const stmt = db.prepare(
    "UPDATE items SET topic = COALESCE(?, topic), subtopic = CASE WHEN ? IS NULL THEN subtopic ELSE ? END, importance = COALESCE(?, importance), classify_version = ? WHERE id = ?",
  );

  await mapLimit(chunks, CLASSIFY_CONCURRENCY, async (chunk) => {
    if (Date.now() > stopAt) return;
    const fresh = await classifyGroups(ai, chunk.map(({ g }) => g.members));
    const writes: D1PreparedStatement[] = [];
    chunk.forEach(({ g, i }, k) => {
      const c = fresh[k] ?? { topic: null, subtopic: null, importance: null };
      const prev = known[i]!;
      known[i] = { topic: c.topic ?? prev.topic, subtopic: c.topic ? c.subtopic : prev.subtopic, importance: c.importance ?? prev.importance };
      if (c.topic || c.importance) for (const m of g.members) writes.push(stmt.bind(c.topic, c.topic, c.subtopic, c.importance, CLASSIFY_VERSION, m.id));
    });
    for (let w = 0; w < writes.length; w += 100) await db.batch(writes.slice(w, w + 100));
  });
  return known;
}

/** Classification stops starting new chunks this long before the run's deadline, leaving time for write-ups. */
const CLASSIFY_STOP_BEFORE_MS = 8 * 60_000;

/** A story this widely covered always appears, even when its write-up fails; see `standIn`. */
export const ALWAYS_PUBLISH = 8;

const TIMED_OUT = Symbol("timed out");

/** The write-up, or TIMED_OUT if it is still running at `stopAt`. */
async function beforeHardStop<T>(work: Promise<T>, stopAt: number): Promise<T | typeof TIMED_OUT> {
  const left = stopAt - Date.now();
  if (left <= 0) return TIMED_OUT;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = new Promise<typeof TIMED_OUT>((resolve) => (timer = setTimeout(() => resolve(TIMED_OUT), left)));
  try {
    return await Promise.race([work, stop]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Stands in for a write-up that failed on a widely covered story: a center (else unrated) outlet's own
 * headline and description, attributed, until the next hour's retry (writeupVersion 0 forces one).
 */
export async function standIn(group: { members: readonly Member[]; topic: TopicId | null; subtopic: SubtopicId | null; importance: number | null }, date: string, now: number): Promise<LineupStory | null> {
  const sources = onePerOutlet(group.members);
  const coverage = coverageOf(sources.map((s) => s.outletId));
  if (coverage.total < ALWAYS_PUBLISH) return null;
  const rank = (s: Member) => {
    const o = outletById(s.outletId);
    const side = o ? sideOf(o.lean) : null;
    return (side === "center" ? 0 : side === null ? 1 : 2) + (s.snippet ? 0 : 0.5);
  };
  const pick = [...sources].sort((a, b) => rank(a) - rank(b) || a.outletId.localeCompare(b.outletId))[0]!;
  const outlet = outletById(pick.outletId)?.name ?? pick.outletId;
  return {
    id: await sha256Hex(`${date}:${sources.map((s) => s.id).join(",")}`),
    topic: group.topic ?? "world",
    subtopic: group.topic ? group.subtopic : null,
    headline: pick.title,
    dek: null,
    why: null,
    summary: [{ text: `${outlet} reports: ${pick.snippet || pick.title}`, cites: [pick.id] }],
    differences: [],
    coverage,
    blindspot: blindspotOf(coverage),
    itemIds: sources.map((s) => s.id),
    imageItemId: pickImage(sources),
    importance: group.importance,
    writtenTotal: 0,
    writeupVersion: 0,
    firstSeenAt: now,
    writtenAt: null,
  };
}

async function writeUp(ai: AiRunner, group: Picked, date: string, now: number, previous?: LineupStory | null): Promise<LineupStory | null> {
  const sources = onePerOutlet(group.members);
  try {
    const published = previous && previous.writeupVersion > 0 ? `${previous.headline}. ${previous.summary.map((s) => s.text).join(" ")}` : undefined;
    const w = await summarize(ai, sources, now, published);
    if (!w) return standIn(group, date, now);
    const kept = sources.filter((s) => !w.offTopic.includes(s.id));
    const coverage = coverageOf(kept.map((s) => s.outletId));
    if (coverage.total < SECTION_MIN_OUTLETS) return null;
    return {
      id: await sha256Hex(`${date}:${kept.map((s) => s.id).join(",")}`),
      // The section decided before selection wins, so a story stays in the section it was picked for.
      topic: group.topic ?? w.topic,
      subtopic: group.topic ? group.subtopic : null,
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
      writtenAt: now,
      firstSeenAt: now,
      flagged: w.edited === false,
    };
  } catch (err) {
    console.error(`summary failed: ${err instanceof Error ? err.message : String(err)}`);
    return standIn(group, date, now);
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
    // The story keeps its section; its subtopic follows this hour's rating when that agrees on the section.
    subtopic: group.topic === ex.topic ? group.subtopic : subtopicUnder(ex.topic, ex.subtopic),
    headline: ex.headline,
    dek: ex.dek ? JSON.parse(ex.dek) : null,
    why: ex.why ? JSON.parse(ex.why) : null,
    summary: JSON.parse(ex.summary),
    differences: JSON.parse(ex.differences),
    coverage,
    blindspot: blindspotOf(coverage),
    itemIds,
    // Re-picked each hour, so a sharper photo from a newly arrived source can replace a weak one.
    imageItemId: pickImage(onePerOutlet(group.members)) ?? ex.image_item_id,
    importance: group.importance ?? ex.importance,
    writeupVersion: ex.writeup_version,
    writtenAt: ex.written_at,
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

/** The last 24 hours of headlines with their vectors. Only headlines new since the last run are embedded. */
export async function windowItems(db: D1Database, ai: AiRunner, now: number): Promise<{ results: ItemRow[]; members: Member[] }> {
  await embedPending(db, ai, now - WINDOW_MS);
  const { results } = await db
    .prepare(
      `SELECT id, outlet_id, title, snippet, published_at, image_url, embedding, topic, subtopic, importance, classify_version FROM items
       WHERE published_at > ? AND published_at <= ? AND embedding IS NOT NULL`,
    )
    .bind(now - WINDOW_MS, now)
    .all<ItemRow>();
  const members: Member[] = results.flatMap((r) => {
    const vec = decodeVector(r.embedding);
    // Ratings made under older rules are forgotten, so the group is classified again.
    const current = r.classify_version >= CLASSIFY_VERSION;
    return vec ? [{ id: r.id, outletId: r.outlet_id, publishedAt: r.published_at, title: r.title, snippet: r.snippet, imageUrl: r.image_url, topic: current ? r.topic : null, subtopic: current ? r.subtopic : null, importance: current ? r.importance : null, vec }] : [];
  });
  return { results, members };
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
/** `deadlineAt` is when the whole run must be done; a cron run passes its own start + RUN_BUDGET_MS, so time spent pulling feeds counts. */
export async function buildEdition(db: D1Database, rawAi: AiRunner, now = Date.now(), opts: { force?: boolean; deadlineAt?: number } = {}): Promise<BuildReport> {
  const ai = withRateLimitRetry(rawAi);
  const date = utcDate(now);
  const deadlineAt = opts.deadlineAt ?? Date.now() + RUN_BUDGET_MS;
  const empty = { date, items: 0, candidates: 0, stories: 0, written: 0, kept: 0 };
  if (!(await lock(db, date, now))) return { ...empty, status: "skipped", error: "another build is running" };

  let report: BuildReport = { ...empty, status: "failed" };
  try {
    const { results, members } = await windowItems(db, ai, now);
    report = { ...report, items: results.length };
    if (results.length < MIN_ITEMS) throw new Error(`only ${results.length} headlines in the last 24 hours`);

    const ranked = rankGroups(clusterItems(members, SAME_EVENT)).slice(0, CLASSIFY_LIMIT);
    const topics = await sections(db, ai, ranked, deadlineAt - CLASSIFY_STOP_BEFORE_MS);
    const picked: Picked[] = pickBalanced(ranked.map((c, i) => ({ ...c, topic: topics[i]?.topic ?? null, subtopic: topics[i]?.subtopic ?? null, importance: topics[i]?.importance ?? null })));
    report = { ...report, candidates: picked.length };

    const { results: existing } = await db
      .prepare("SELECT id, topic, subtopic, headline, summary, differences, item_ids, dek, why, image_item_id, written_total, first_seen_at, importance, writeup_version, written_at FROM stories WHERE edition_date = ?")
      .bind(date)
      .all<ExistingRow>();
    const outletOf = await outletsOf(db, results, existing);
    const matches = matchStories(picked.map((p) => p.members.map((m) => m.id)), existing.map((e) => JSON.parse(e.item_ids) as string[]));
    // A story still running when the UTC date turns keeps when it was first seen in yesterday's edition,
    // so it isn't "new" (or breaking news) again just because a new edition started.
    const { results: yesterday } = await db
      .prepare("SELECT item_ids, first_seen_at FROM stories WHERE edition_date = ?")
      .bind(utcDate(now - 24 * 3600_000))
      .all<{ item_ids: string; first_seen_at: number | null }>();
    const seenYesterday = matchStories(picked.map((p) => p.members.map((m) => m.id)), yesterday.map((y) => JSON.parse(y.item_ids) as string[]))
      .map((y) => (y >= 0 ? yesterday[y]!.first_seen_at : null));

    let budget = WRITE_BUDGET;
    const lineup = await mapLimit(picked, CONCURRENCY, async (group, i) => {
      const ex = matches[i]! >= 0 ? existing[matches[i]!]! : null;
      const carried = ex ? carryOver(ex, group, outletOf, now) : null;
      const outdated = !!ex && ex.writeup_version < WRITEUP_VERSION;
      const rewrite = !carried || opts.force || outdated || needsRewrite(carried.writtenTotal, carried.coverage.total);
      if (!rewrite || budget <= 0 || Date.now() > deadlineAt - LAST_START_BEFORE_MS) return carried && checkBlindspot(carried, group, members);
      budget -= 1;
      const written = await beforeHardStop(writeUp(ai, group, date, now, carried), deadlineAt - HARD_STOP_BEFORE_MS);
      if (written === TIMED_OUT) return carried && checkBlindspot(carried, group, members);
      // A story the editor flagged on both tries, with nothing published yet, runs as an attributed stand-in instead.
      const fresh = written?.flagged && !carried ? await standIn(group, date, now) : written;
      // A rewrite keeps the story's id and first-seen time, so its link and "new" marker don't change. Its sources
      // are the fresh write-up's, so the source list always matches the counts.
      // A failed rewrite (stand-in, version 0) never replaces an existing write-up.
      // Nor does one the final editor flagged: the published version stays until a rewrite passes.
      const usable = fresh && !(carried && (fresh.writeupVersion === 0 || fresh.flagged)) ? fresh : null;
      const story = usable && carried ? { ...usable, id: carried.id, firstSeenAt: carried.firstSeenAt } : (usable ?? carried);
      return story && checkBlindspot(story, group, members);
    });

    // How new each story's latest report is decides which important story leads; it's used for ordering, not stored.
    const timed = lineup.map((s, i) => s && { ...s, firstSeenAt: Math.min(s.firstSeenAt, seenYesterday[i] ?? Infinity), fresh: freshness(s.importance, picked[i]!.latest, now) });
    const stories = [...new Map(timed.filter((s): s is LineupStory & { fresh: number } => s !== null).map((s) => [s.id, s])).values()];
    if (stories.length === 0 && existing.length === 0) throw new Error("no story survived the write-up checks");
    if (stories.length === 0) throw new Error("no story this hour; keeping the previous lineup");

    const front = frontPage(stories, FRONT_SIZE);
    // Front page first in its own order, then the rest by breadth (sections list them in this order).
    const ordered = [...stories].sort((a, b) => Number(front.has(b)) - Number(front.has(a)) || (front.has(a) ? frontOrder(a, b) : sectionOrder(a, b)));
    const upsert = db.prepare(
      `INSERT INTO stories (id, edition_date, rank, front, topic, subtopic, headline, summary, differences, coverage, blindspot, item_ids, image_item_id,
                            active, first_seen_at, updated_at, written_total, importance, writeup_version, dek, why, written_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET rank = excluded.rank, front = excluded.front, topic = excluded.topic, subtopic = excluded.subtopic, headline = excluded.headline,
         summary = excluded.summary, differences = excluded.differences, coverage = excluded.coverage, blindspot = excluded.blindspot,
         item_ids = excluded.item_ids, image_item_id = excluded.image_item_id, active = 1, updated_at = excluded.updated_at,
         written_total = excluded.written_total, importance = excluded.importance, writeup_version = excluded.writeup_version,
         dek = excluded.dek, why = excluded.why, written_at = excluded.written_at`,
    );
    const live = new Set(ordered.map((s) => s.id));
    const retire = db.prepare("UPDATE stories SET active = 0, front = 0 WHERE id = ?");
    await db.batch([
      ...ordered.map((s, rank) =>
        upsert.bind(
          s.id, date, rank, front.has(s) ? 1 : 0, s.topic, s.subtopic, s.headline, JSON.stringify(s.summary), JSON.stringify(s.differences),
          JSON.stringify(s.coverage), s.blindspot, JSON.stringify(s.itemIds), s.imageItemId, s.firstSeenAt, now, s.writtenTotal, s.importance, s.writeupVersion,
          s.dek ? JSON.stringify(s.dek) : null, s.why ? JSON.stringify(s.why) : null, s.writtenAt,
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
