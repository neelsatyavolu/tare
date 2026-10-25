import { buildEdition, RUN_BUDGET_MS } from "./build/build";
import type { Env } from "./env";
import { ingest } from "./ingest/ingest";
import { sendEdition } from "./mail/send";

export const JOBS = {
  ingest: (env: Env) => ingest(env.DB),
  build: (env: Env, force = false, deadlineAt?: number) => buildEdition(env.DB, env.AI, Date.now(), { force, deadlineAt }),
  send: (env: Env) => sendEdition(env, fetch, Date.now(), undefined, "am"),
  "send-evening": (env: Env) => sendEdition(env, fetch, Date.now(), undefined, "pm"),
} as const;

export type JobName = keyof typeof JOBS;

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
    return;
  }
  const result = await JOBS[job](env);
  console.log(JSON.stringify({ job, result }));
}
