-- A dated note on a story the editor corrected, shown on its page. Rewrites don't touch it.
ALTER TABLE stories ADD COLUMN correction_note TEXT;
ALTER TABLE stories ADD COLUMN corrected_at INTEGER;
