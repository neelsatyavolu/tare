import { buildEdition, RUN_BUDGET_MS } from "./build/build";
import { notifyBreaking, notifyDue } from "./push/notify";
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
    try {
      console.log(JSON.stringify({ job: "auto-briefings", result: await queueAutoBriefings(env) }));
    } catch (err) {
      console.error(`auto briefings failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }
  const result = await JOBS[job](env);
  console.log(JSON.stringify({ job, result }));
}
