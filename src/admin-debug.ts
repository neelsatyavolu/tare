import { storyById } from "./editions";
import type { Env } from "./env";
import { summarize, type AiRunner, type SourceItem, type Writeup } from "./build/summarize";

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
