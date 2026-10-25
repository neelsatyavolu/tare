/** A reader's note that a story got something wrong. Stored for the editor; never shown publicly. */
export type ErrorReport = { id: number; storyId: string; body: string; createdAt: number };

export const REPORT_MIN = 10;
export const REPORT_MAX = 1000;

/** The report text if it's usable, else null: trimmed, whitespace collapsed, within the length bounds. */
export function parseReport(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const body = raw.replace(/\s+/g, " ").trim();
  return body.length >= REPORT_MIN && body.length <= REPORT_MAX ? body : null;
}

export async function saveReport(db: D1Database, storyId: string, body: string, now: number): Promise<void> {
  await db.prepare("INSERT INTO error_reports (story_id, body, created_at) VALUES (?, ?, ?)").bind(storyId, body, now).run();
}

export async function recentReports(db: D1Database, limit = 100): Promise<ErrorReport[]> {
  const { results } = await db
    .prepare("SELECT id, story_id, body, created_at FROM error_reports ORDER BY created_at DESC LIMIT ?")
    .bind(limit)
    .all<{ id: number; story_id: string; body: string; created_at: number }>();
  return results.map((r) => ({ id: r.id, storyId: r.story_id, body: r.body, createdAt: r.created_at }));
}
