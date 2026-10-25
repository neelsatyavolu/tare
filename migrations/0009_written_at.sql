-- When a story's write-up was last written (not just touched by an hourly run), for the "Updated" marker.
ALTER TABLE stories ADD COLUMN written_at INTEGER;
