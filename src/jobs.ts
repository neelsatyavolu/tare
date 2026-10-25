import { buildEdition } from "./build/build";
import type { Env } from "./env";
import { ingest } from "./ingest/ingest";
import { sendEdition } from "./mail/send";

export const JOBS = {
  ingest: (env: Env) => ingest(env.DB),
  build: (env: Env, force = false) => buildEdition(env.DB, env.AI, Date.now(), { force }),
  send: (env: Env) => sendEdition(env),
} as const;

export type JobName = keyof typeof JOBS;

/** Cron expressions in wrangler.jsonc, mapped to the job each one runs. */
export const CRON_JOBS: Record<string, JobName> = {
  // Hourly: pull every feed, then refresh today's edition so breaking stories appear within the hour.
  "7 * * * *": "build",
  "0 11 * * *": "send",
  // Resumes the day's send for anyone the first run missed (Resend errors, daily quota).
  "0 13 * * *": "send",
};

export async function runCron(cron: string, env: Env): Promise<void> {
  const job = CRON_JOBS[cron];
  if (!job) {
    console.error(`no job for cron "${cron}"`);
    return;
  }
  // The build reads this hour's headlines, so it pulls feeds first; a failed pull doesn't stop it.
  if (job === "build") {
    try {
      await JOBS.ingest(env);
    } catch (err) {
      console.error(`pre-build ingest failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const result = await JOBS[job](env);
  console.log(JSON.stringify({ job, result }));
}
