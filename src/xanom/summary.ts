/**
 * The summary card on the Xanom dashboard (§4): topics followed, the email edition setting, and the detailed
 * briefings this reader asked for, with the three newest. No email address, no briefing text.
 */
export type Summary =
  | { linked: false }
  | { linked: true; headline: string; items: { label: string; value: string }[]; recent: { title: string; url: string; at: string }[]; url: string };

type Row = { id: string; topics: string; status: string; editions: string | null };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function emailSetting(row: Row): string {
  if (row.status !== "active") return "Off";
  return row.editions === "morning" ? "Mornings" : row.editions === "evening" ? "Evenings" : "Morning and evening";
}

export async function summaryFor(db: D1Database, sub: string, appUrl: string): Promise<Summary> {
  const row = await db.prepare("SELECT id, topics, status, editions FROM subscribers WHERE xanom_sub = ?").bind(sub).first<Row>();
  if (!row) return { linked: false };
  const topics = (() => {
    try {
      const t = JSON.parse(row.topics);
      return Array.isArray(t) ? t.length : 0;
    } catch {
      return 0;
    }
  })();
  const [count, recent] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM briefings WHERE requested_by = ? AND status = 'ready'").bind(row.id).first<{ n: number }>(),
    db
      .prepare(
        `SELECT b.story_id, b.requested_at, s.headline FROM briefings b JOIN stories s ON s.id = b.story_id
          WHERE b.requested_by = ? AND b.status = 'ready' ORDER BY b.requested_at DESC LIMIT 3`,
      )
      .bind(row.id)
      .all<{ story_id: string; requested_at: number; headline: string }>(),
  ]);
  const briefings = count?.n ?? 0;
  const email = emailSetting(row);
  return {
    linked: true,
    headline: [plural(topics, "topic", "topics"), plural(briefings, "briefing", "briefings"), email === "Off" ? "email off" : "email on"].join(" · "),
    items: [
      { label: "Topics followed", value: String(topics) },
      { label: "Detailed briefings", value: String(briefings) },
      { label: "Email editions", value: email },
    ],
    recent: recent.results.map((r) => ({ title: r.headline, url: `${appUrl}/s/${r.story_id}`, at: new Date(r.requested_at).toISOString() })),
    url: `${appUrl}/`,
  };
}
