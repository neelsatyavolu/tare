-- Live editions: the build runs every hour and updates today's edition in place.
-- Stories are never deleted, so links in emails keep working; `active` marks the current lineup.
ALTER TABLE stories ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE stories ADD COLUMN first_seen_at INTEGER;
ALTER TABLE stories ADD COLUMN updated_at INTEGER;
CREATE INDEX stories_lineup ON stories (edition_date, active, rank);

-- Keeps two builds (cron and a manual run) from working on the same edition at once.
ALTER TABLE editions ADD COLUMN lock_until INTEGER;

-- Each headline is embedded once, at ingest, instead of on every hourly build (Float32 little-endian).
ALTER TABLE items ADD COLUMN embedding BLOB;
-- The section its event group was sorted into, so hourly builds only classify new events.
ALTER TABLE items ADD COLUMN topic TEXT;

-- How many outlets a story had when its write-up was last written; a big jump triggers a rewrite.
ALTER TABLE stories ADD COLUMN written_total INTEGER;
