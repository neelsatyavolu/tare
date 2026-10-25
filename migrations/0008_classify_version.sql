-- Which version of the section/importance rules classified an item; older ones are classified again.
ALTER TABLE items ADD COLUMN classify_version INTEGER NOT NULL DEFAULT 1;
