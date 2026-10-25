import { requestBriefing } from "./briefing";
import { latestEdition, storiesFor } from "./editions";
import type { Env } from "./env";

/**
 * Automatic briefings: after each hourly build, front-page stories without a briefing get one written by a
 * reader who opted in, using that reader's own connected account. Small caps keep it cheap for them.
 */
export const AUTO_PER_BUILD = 3;
export const AUTO_PER_READER_PER_DAY = 6;
/** A reader whose last automatic briefing failed (expired account, usage limit) is skipped for a while. */
const FAILURE_PAUSE_MS = 6 * 3600_000;

export async function setAutoBriefings(db: D1Database, subscriberId: string, on: boolean): Promise<void> {
  await db.prepare("UPDATE ai_connections SET auto_briefings = ? WHERE subscriber_id = ?").bind(on ? 1 : 0, subscriberId).run();
}

export async function autoBriefingsOn(db: D1Database, subscriberId: string): Promise<boolean> {
  const row = await db.prepare("SELECT auto_briefings FROM ai_connections WHERE subscriber_id = ?").bind(subscriberId).first<{ auto_briefings: number }>();
  return row?.auto_briefings === 1;
}

/** Opted-in readers with allowance left today, least used first. */
async function helpers(db: D1Database, now: number): Promise<{ id: string; left: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT c.subscriber_id AS id,
         (SELECT COUNT(*) FROM briefings b WHERE b.requested_by = c.subscriber_id AND b.auto = 1 AND b.requested_at > ?) AS used
       FROM ai_connections c
       WHERE c.auto_briefings = 1
         AND NOT EXISTS (SELECT 1 FROM briefings f WHERE f.requested_by = c.subscriber_id AND f.auto = 1 AND f.status = 'failed' AND f.requested_at > ?)
       ORDER BY used, c.updated_at`,
    )
    .bind(now - 24 * 3600_000, now - FAILURE_PAUSE_MS)
    .all<{ id: string; used: number }>();
  return results.map((r) => ({ id: r.id, left: AUTO_PER_READER_PER_DAY - r.used })).filter((h) => h.left > 0);
}

/** Queues briefings for the most important front-page stories that have none, spread across helpers. */
export async function queueAutoBriefings(env: Env, now = Date.now()): Promise<{ queued: number }> {
  const pool = await helpers(env.DB, now);
  if (pool.length === 0) return { queued: 0 };
  const edition = await latestEdition(env.DB);
  if (!edition) return { queued: 0 };
  const front = (await storiesFor(env.DB, edition.date)).filter((s) => s.front);
  if (front.length === 0) return { queued: 0 };
  const { results } = await env.DB
    .prepare(`SELECT story_id FROM briefings WHERE story_id IN (${front.map(() => "?").join(",")})`)
    .bind(...front.map((s) => s.id))
    .all<{ story_id: string }>();
  const done = new Set(results.map((r) => r.story_id));
  const wanted = front.filter((s) => !done.has(s.id)).slice(0, AUTO_PER_BUILD);

  let queued = 0;
  for (const story of wanted) {
    const helper = pool.filter((h) => h.left > 0).sort((a, b) => b.left - a.left)[0];
    if (!helper) break;
    if (await requestBriefing(env, story.id, helper.id, now, { auto: true })) {
      helper.left -= 1;
      queued += 1;
    }
  }
  return { queued };
}
