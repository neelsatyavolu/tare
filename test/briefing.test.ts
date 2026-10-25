import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seal, saveConnection, unseal, usableTokens } from "../src/ai/vault";
import type { AiTokens } from "../src/ai/oauth";
import { loadBriefing, requestBriefing, runBriefing, validateBriefing } from "../src/briefing";
import { signUp } from "../src/subscribers";

const KEY = env.AI_TOKEN_KEY!;
const TOKENS: AiTokens = { accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 3600_000, provider: "grok" };

describe("vault", () => {
  it("seals tokens to one account", async () => {
    const sealed = await seal(TOKENS, KEY, "sub-1");
    expect(await unseal(sealed, KEY, "sub-1")).toEqual(TOKENS);
    expect(await unseal(sealed, KEY, "sub-2")).toBeNull();
    expect(await unseal("garbage", KEY, "sub-1")).toBeNull();
  });
});

describe("validateBriefing", () => {
  const retrieved = new Set(["https://court.test/filing"]);
  const reply = {
    sections: [
      { heading: "What happened", paragraphs: [{ text: "The Senate passed it.", sources: ["1", 2] }, { text: "Uncited.", sources: [] }] },
      { heading: "Background", paragraphs: [{ text: "A court filing says so.", sources: ["w1"] }, { text: "Made up page.", sources: ["w2"] }] },
      { heading: "Out of range", paragraphs: [{ text: "Cites 9.", sources: ["9"] }] },
    ],
    web: [
      { id: "w1", title: "Filing", url: "https://court.test/filing?utm_source=x" },
      { id: "w2", title: "Never opened", url: "https://fake.test/page" },
    ],
  };

  it("keeps paragraphs with checkable sources and only pages the model opened", () => {
    const b = validateBriefing(reply, 3, retrieved)!;
    expect(b.sections.map((s) => s.heading)).toEqual(["What happened", "Background"]);
    expect(b.sections[0]!.paragraphs).toEqual([{ text: "The Senate passed it.", cites: [1, 2], web: [] }]);
    expect(b.sections[1]!.paragraphs).toEqual([{ text: "A court filing says so.", cites: [], web: ["w1"] }]);
    expect(b.web).toEqual([{ id: "w1", title: "Filing", url: "https://court.test/filing" }]);
  });

  it("rejects a briefing with fewer than two usable sections", () => {
    expect(validateBriefing({ sections: [reply.sections[0]] }, 3, retrieved)).toBeNull();
    expect(validateBriefing({ nope: true }, 3, retrieved)).toBeNull();
  });
});

const STORY = "c".repeat(32);

async function seedStory() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM briefings"),
    env.DB.prepare("DELETE FROM stories"),
    env.DB.prepare("DELETE FROM items"),
    env.DB.prepare("DELETE FROM ai_connections"),
    env.DB.prepare("DELETE FROM sessions"),
    env.DB.prepare("DELETE FROM subscribers"),
    env.DB.prepare("INSERT OR IGNORE INTO editions (date, number, status) VALUES ('2026-10-25', 1, 'ready')"),
    env.DB.prepare("INSERT INTO items (id, outlet_id, url, title, snippet, published_at, fetched_at) VALUES ('i1','vox','https://vox.test/1','Vox headline','',0,0), ('i2','fox','https://fox.test/1','Fox headline','',0,0)"),
    env.DB.prepare("INSERT INTO stories (id, edition_date, rank, front, topic, headline, summary, differences, coverage, blindspot, item_ids) VALUES (?, '2026-10-25', 0, 1, 'politics', 'Senate passes bill', ?, '[]', ?, NULL, '[\"i1\",\"i2\"]')")
      .bind(STORY, JSON.stringify([{ text: "The Senate passed it.", cites: ["i1"] }]), JSON.stringify({ left: 1, center: 0, right: 1, unrated: 0, total: 2, balance: 0 })),
  ]);
}

/** A Grok-style SSE stream: one web search, then the final message. */
function sse(text: string) {
  const events = [
    { type: "response.output_item.done", item: { type: "web_search_call", action: { url: "https://vox.test/1" } } },
    { type: "response.completed", response: { output: [{ type: "message", content: [{ text }] }] } },
  ];
  return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}

describe("briefing jobs", () => {
  beforeEach(seedStory);
  afterEach(() => vi.restoreAllMocks());

  it("queues once, writes with the reader's account, and saves for everyone", async () => {
    const reader = await signUp(env.DB, "r@ex.com", [], 0);
    await saveConnection(env.DB, KEY, reader.id, TOKENS);

    const sent: unknown[] = [];
    vi.spyOn(env.BRIEFING_QUEUE, "send").mockImplementation((async (body: unknown) => void sent.push(body)) as never);
    expect(await requestBriefing(env, STORY, reader.id)).toBe(true);
    expect(await requestBriefing(env, STORY, reader.id)).toBe(false);
    expect(sent).toEqual([{ storyId: STORY, subscriberId: reader.id }]);
    expect((await loadBriefing(env.DB, STORY))?.status).toBe("writing");

    const reply = { sections: [
      { heading: "What happened", paragraphs: [{ text: "Passed 52-48.", sources: ["1"] }] },
      { heading: "Background", paragraphs: [{ text: "It funds the government.", sources: ["2"] }] },
    ], web: [] };
    // Not a model call we can make in tests: answer the provider and model-catalog requests here.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => (String(url).includes("x.ai") ? sse(JSON.stringify(reply)) : new Response("{}", { status: 404 })));
    await runBriefing(env, { storyId: STORY, subscriberId: reader.id });

    const saved = await loadBriefing(env.DB, STORY);
    expect(saved).toMatchObject({ status: "ready", provider: "grok" });
    expect(saved?.body?.sections).toHaveLength(2);
  });

  it("records a clear failure when the reader's account is gone, and allows a retry", async () => {
    const reader = await signUp(env.DB, "gone@ex.com", [], 0);
    vi.spyOn(env.BRIEFING_QUEUE, "send").mockImplementation((async () => {}) as never);
    await requestBriefing(env, STORY, reader.id);
    await runBriefing(env, { storyId: STORY, subscriberId: reader.id });
    expect(await loadBriefing(env.DB, STORY)).toMatchObject({ status: "failed", error: "The AI account that asked for this briefing is no longer connected." });
    expect(await requestBriefing(env, STORY, reader.id)).toBe(true);
  });

  it("refreshes expired tokens before use", async () => {
    const reader = await signUp(env.DB, "old@ex.com", [], 0);
    await saveConnection(env.DB, KEY, reader.id, { ...TOKENS, expiresAt: 0 });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ access_token: "new", refresh_token: "r2", expires_in: 3600 }), { headers: { "content-type": "application/json" } }),
    );
    const t = await usableTokens(env.DB, KEY, reader.id);
    expect(t?.accessToken).toBe("new");
  });
});
