import { storyById } from "./editions";
import type { Env } from "./env";
import { summarize, type AiRunner, type SourceItem, type Writeup } from "./build/summarize";
import { clusterItems } from "./build/cluster";
import { decodeVector } from "./build/embed";
import { rankGroups } from "./build/select";

/**
 * Writes one published story again with a chosen Workers AI model and returns the result without saving it, so
 * a model can be compared against the current one on real clusters before switching.
 */
export async function rewriteSample(env: Env, storyId: string, model: string): Promise<{ ms: number; writeup: Writeup | null } | null> {
  const story = await storyById(env.DB, storyId);
  if (!story) return null;
  const marks = story.itemIds.map(() => "?").join(",");
  const { results } = await env.DB.prepare(`SELECT id, outlet_id, title, snippet, published_at FROM items WHERE id IN (${marks})`)
    .bind(...story.itemIds)
    .all<{ id: string; outlet_id: string; title: string; snippet: string; published_at: number }>();
  const items: SourceItem[] = results.map((r) => ({ id: r.id, outletId: r.outlet_id, title: r.title, snippet: r.snippet, publishedAt: r.published_at }));
  const runner: AiRunner = { run: (_model, input) => env.AI.run(model as Parameters<Env["AI"]["run"]>[0], input as never) };
  const started = Date.now();
  const writeup = await summarize(runner, items);
  return { ms: Date.now() - started, writeup };
}

/**
 * How the last 24 hours of headlines group at a given similarity threshold: the number of groups with 2+ outlets
 * and each group's headlines, for tuning SAME_EVENT against live data. Nothing is saved.
 */
export async function clusterSample(env: Env, threshold: number, now = Date.now()): Promise<{ groups: number; sample: { outlets: number; topic: string | null; importance: number | null; titles: string[] }[] }> {
  const { results } = await env.DB.prepare("SELECT id, outlet_id, title, published_at, embedding, topic, importance FROM items WHERE published_at > ? AND embedding IS NOT NULL")
    .bind(now - 24 * 3600_000)
    .all<{ id: string; outlet_id: string; title: string; published_at: number; embedding: unknown; topic: string | null; importance: number | null }>();
  const members = results.flatMap((r) => {
    const vec = decodeVector(r.embedding);
    return vec ? [{ id: r.id, outletId: r.outlet_id, publishedAt: r.published_at, title: r.title, topic: r.topic, importance: r.importance, vec }] : [];
  });
  const ranked = rankGroups(clusterItems(members, threshold));
  return {
    groups: ranked.length,
    sample: ranked.map((c) => ({ outlets: c.coverage.total, topic: c.members.find((m) => m.topic)?.topic ?? null, importance: c.members.find((m) => m.importance)?.importance ?? null, titles: c.members.slice(0, 5).map((m) => m.title) })),
  };
}
