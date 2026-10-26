import { buildEdition, RUN_BUDGET_MS } from "./build/build";
import { notifyBreaking, notifyDue } from "./push/notify";
import { watchBreaking } from "./push/watch";
import { utcDate } from "./util";
import { queueAutoBriefings } from "./auto-briefings";
import type { Env } from "./env";
import { ingest } from "./ingest/ingest";
import { sendDue, sendEdition } from "./mail/send";

export const JOBS = {
  ingest: (env: Env) => ingest(env.DB),
  build: (env: Env, force = false, deadlineAt?: number) => buildEdition(env.DB, env.AI, Date.now(), { force, deadlineAt }),
  // Manual runs: one slot's email to every reader who hasn't had it, whatever their local time.
  send: async (env: Env) => ({ email: await sendEdition(env, fetch, Date.now(), undefined, "am") }),
  "send-evening": async (env: Env) => ({ email: await sendEdition(env, fetch, Date.now(), undefined, "pm") }),
  // Hourly: email and push each reader whose local clock is at 7 a.m. or 6 p.m.
  "send-due": async (env: Env) => ({ email: await sendDue(env), push: await pushDue(env) }),
  // Between builds: pull feeds and check for major news that has just broken (see runCron).
  watch: (env: Env) => watchBreaking(env.DB, env.AI, Date.now(), Date.now() + RUN_BUDGET_MS),
} as const;

export type JobName = keyof typeof JOBS;

/** The edition push for phones due now; a failure is logged so it can't stop the email run. */
async function pushDue(env: Env) {
  try {
    return await notifyDue(env);
  } catch (err) {
    console.error(`edition push failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Cron expressions in wrangler.jsonc, mapped to the job each one runs. */
export const CRON_JOBS: Record<string, JobName> = {
  // Hourly: pull every feed, then refresh today's edition so breaking stories appear within the hour.
  "7 * * * *": "build",
  // Every hour on the hour: the morning and evening editions for readers whose local time is 7 a.m. or 6 p.m.
  // (or the hour after, which retries anyone a failed run missed).
  "0 * * * *": "send-due",
  // Every 5 minutes outside the build's usual run (:07 to :20): breaking news, without rebuilding the edition.
  "2,22,27,32,37,42,47,52,57 * * * *": "watch",
};

export async function runCron(cron: string, env: Env): Promise<void> {
  const job = CRON_JOBS[cron];
  if (!job) {
    console.error(`no job for cron "${cron}"`);
    return;
  }
  if (job === "build") {
    const deadlineAt = await pullFeeds(env, job);
    const result = await JOBS.build(env, false, deadlineAt);
    console.log(JSON.stringify({ job, result }));
    await pushBreaking(env);
    try {
      console.log(JSON.stringify({ job: "auto-briefings", result: await queueAutoBriefings(env) }));
    } catch (err) {
      console.error(`auto briefings failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }
  // The edition is refreshed (writing up only what's new) and alerts sent only when a major story has just broken.
  if (job === "watch") {
    if (await building(env)) return;
    const deadlineAt = await pullFeeds(env, job);
    const watch = await watchBreaking(env.DB, env.AI, Date.now(), deadlineAt);
    console.log(JSON.stringify({ job, watch }));
    if (watch.major === 0) return;
    console.log(JSON.stringify({ job, result: await JOBS.build(env, false, deadlineAt) }));
    await pushBreaking(env);
    return;
  }
  const result = await JOBS[job](env);
  console.log(JSON.stringify({ job, result }));
}

/**
 * Pulls every feed before a build or watch reads this hour's headlines; a failed pull doesn't stop it. Returns the
 * run's deadline, counted from now, so a slow pull leaves less time for rewrites rather than pushing the run past the limit.
 */
async function pullFeeds(env: Env, job: JobName): Promise<number> {
  const deadlineAt = Date.now() + RUN_BUDGET_MS;
  try {
    await JOBS.ingest(env);
  } catch (err) {
    console.error(`pre-${job} ingest failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  console.log(JSON.stringify({ job, ingestMs: Date.now() - (deadlineAt - RUN_BUDGET_MS) }));
  return deadlineAt;
}

/** Breaking-news alerts after a build; a failure is logged so it can't stop the rest of the run. */
async function pushBreaking(env: Env): Promise<void> {
  try {
    const breaking = await notifyBreaking(env);
    if (breaking) console.log(JSON.stringify({ job: "breaking", breaking }));
  } catch (err) {
    console.error(`breaking push failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Whether a build holds today's edition; it pulls feeds itself, so a watch then has nothing to add. */
async function building(env: Env): Promise<boolean> {
  const row = await env.DB.prepare("SELECT lock_until FROM editions WHERE date = ?").bind(utcDate(Date.now())).first<{ lock_until: number | null }>();
  return (row?.lock_until ?? 0) > Date.now();
}
