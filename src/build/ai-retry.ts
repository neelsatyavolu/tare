import type { AiRunner } from "./summarize";

/** Waits after a Workers AI per-minute rate limit (error 3021) before trying again. */
const RATE_LIMIT_DELAYS_MS = [8_000, 20_000, 40_000];

const rateLimited = (err: unknown) => /\b3021\b|rate limit/i.test(err instanceof Error ? err.message : String(err));

/**
 * The same runner, but a request refused for the per-minute rate limit is retried after a pause instead of
 * failing the story's write-up. Any other error is passed through untouched.
 */
export function withRateLimitRetry(ai: AiRunner, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): AiRunner {
  return {
    async run(model, input) {
      for (let attempt = 0; ; attempt++) {
        try {
          return await ai.run(model, input);
        } catch (err) {
          const delay = RATE_LIMIT_DELAYS_MS[attempt];
          if (!rateLimited(err) || delay === undefined) throw err;
          await sleep(delay);
        }
      }
    },
  };
}
