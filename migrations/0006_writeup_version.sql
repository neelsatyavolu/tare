-- Which version of the write-up rules wrote a story; hourly builds rewrite stories written under older rules.
ALTER TABLE stories ADD COLUMN writeup_version INTEGER NOT NULL DEFAULT 1;
