import { buildEdition, RUN_BUDGET_MS } from "./build/build";
import { notifyBreaking, notifyEdition } from "./push/notify";
import { SEND_HOUR_UTC, type Slot } from "./slots";
import type { Env } from "./env";
import { ingest } from "./ingest/ingest";
import { sendEdition } from "./mail/send";

export const JOBS = {
  ingest: (env: Env) => ingest(env.DB),
  build: (env: Env, force = false, deadlineAt?: number) => buildEdition(env.DB, env.AI, Date.now(), { force, deadlineAt }),
  send: async (env: Env) => ({ email: await sendEdition(env, fetch, Date.now(), undefined, "am"), push: await pushOnce(env, "am") }),
  "send-evening": async (env: Env) => ({ email: await sendEdition(env, fetch, Date.now(), undefined, "pm"), push: await pushOnce(env, "pm") }),
} as const;

export type JobName = keyof typeof JOBS;

/**
 * The edition push goes out with the first send run of a slot only (the retry run resends email to those it
 * missed; pushing again would buzz phones twice). The first runs are at SEND_HOUR_UTC.
 */
async function pushOnce(env: Env, slot: Slot) {
  if (new Date().getUTCHours() !== SEND_HOUR_UTC[slot]) return null;
  try {
    return await notifyEdition(env, slot);
  } catch (err) {
    console.error(`edition push failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Cron expressions in wrangler.jsonc, mapped to the job each one runs. */
export const CRON_JOBS: Record<string, JobName> = {
  // Hourly: pull every feed, then refresh today's edition so breaking stories appear within the hour.
  "7 * * * *": "build",
  // Morning edition (7 a.m. Eastern in daylight time), then the evening edition (6 p.m.). Each has a second run that
  // resumes the send for anyone the first missed (Resend errors, daily quota). Hours match SEND_HOUR_UTC.
  "0 11 * * *": "send",
  "0 13 * * *": "send",
  "0 22 * * *": "send-evening",
  "30 23 * * *": "send-evening",
};

export async function runCron(cron: string, env: Env): Promise<void> {
  const job = CRON_JOBS[cron];
  if (!job) {
    console.error(`no job for cron "${cron}"`);
    return;
  }
  // The build reads this hour's headlines, so it pulls feeds first; a failed pull doesn't stop it. Its deadline
  // counts from now, so a slow pull leaves less time for rewrites rather than pushing the run past the limit.
  if (job === "build") {
    const deadlineAt = Date.now() + RUN_BUDGET_MS;
    try {
      await JOBS.ingest(env);
    } catch (err) {
      console.error(`pre-build ingest failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    console.log(JSON.stringify({ job, ingestMs: Date.now() - (deadlineAt - RUN_BUDGET_MS) }));
    const result = await JOBS.build(env, false, deadlineAt);
    console.log(JSON.stringify({ job, result }));
    try {
      const breaking = await notifyBreaking(env);
      if (breaking) console.log(JSON.stringify({ job: "breaking", breaking }));
    } catch (err) {
      console.error(`breaking push failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }
  const result = await JOBS[job](env);
  console.log(JSON.stringify({ job, result }));
}
