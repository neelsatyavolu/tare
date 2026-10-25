import { normalize } from "./cluster";
import type { AiRunner } from "./summarize";

export const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";
const BATCH = 100;
/** Per run; anything left waits for the next hourly run. */
const MAX_PER_RUN = 3000;

export const embedText = (title: string, snippet: string) => `${title}. ${snippet}`.slice(0, 600);

/** Normalized vectors are stored as little-endian Float32 bytes. */
export function encodeVector(v: readonly number[]): ArrayBuffer {
  return new Float32Array(normalize([...v])).buffer;
}

/** D1 hands BLOBs back as an ArrayBuffer or a plain array of bytes, depending on the driver. */
export function decodeVector(blob: unknown): number[] | null {
  if (blob instanceof ArrayBuffer) return [...new Float32Array(blob)];
  if (ArrayBuffer.isView(blob)) return [...new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength))];
  if (Array.isArray(blob)) return [...new Float32Array(Uint8Array.from(blob).buffer)];
  return null;
}

export async function embedTexts(ai: AiRunner, texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const res = (await ai.run(EMBED_MODEL, { text: texts.slice(i, i + BATCH) })) as { data?: number[][] };
    if (!Array.isArray(res?.data) || res.data.length !== Math.min(BATCH, texts.length - i)) throw new Error("embedding reply had the wrong shape");
    out.push(...res.data);
  }
  return out;
}

/** Embeds headlines that don't have a vector yet (each is embedded once, not on every hourly build). */
export async function embedPending(db: D1Database, ai: AiRunner, since: number): Promise<number> {
  const { results } = await db
    .prepare("SELECT id, title, snippet FROM items WHERE embedding IS NULL AND published_at > ? ORDER BY published_at DESC LIMIT ?")
    .bind(since, MAX_PER_RUN)
    .all<{ id: string; title: string; snippet: string }>();
  const stmt = db.prepare("UPDATE items SET embedding = ? WHERE id = ?");
  for (let i = 0; i < results.length; i += BATCH) {
    const chunk = results.slice(i, i + BATCH);
    const vectors = await embedTexts(ai, chunk.map((r) => embedText(r.title, r.snippet)));
    await db.batch(chunk.map((r, j) => stmt.bind(encodeVector(vectors[j]!), r.id)));
  }
  return results.length;
}
