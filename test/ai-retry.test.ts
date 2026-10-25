import { describe, expect, it } from "vitest";
import { withRateLimitRetry } from "../src/build/ai-retry";

describe("withRateLimitRetry", () => {
  it("retries a rate-limited request and passes other errors through", async () => {
    let calls = 0;
    const flaky = { run: async () => (++calls < 3 ? Promise.reject(new Error("3021: rate limiting: inference request per min rate reached")) : "ok") };
    expect(await withRateLimitRetry(flaky, async () => {}).run("m", {})).toBe("ok");
    expect(calls).toBe(3);
    const broken = { run: async () => Promise.reject(new Error("model down")) };
    await expect(withRateLimitRetry(broken, async () => {}).run("m", {})).rejects.toThrow("model down");
  });
});
