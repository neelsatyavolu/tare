-- Readers' "report an error" notes, one row per report, read by the editor through GET /admin/reports.
CREATE TABLE error_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX error_reports_created ON error_reports (created_at);
