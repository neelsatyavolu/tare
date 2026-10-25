const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** For hand-built HTML (email). JSX pages escape on their own. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]!);
}

/** "Saturday, October 24, 2026" for a YYYY-MM-DD edition date. */
export function longDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function coverageLine(c: { total: number; left: number; center: number; right: number }): string {
  return `Covered by ${c.total} outlets · L ${c.left} · C ${c.center} · R ${c.right}`;
}
