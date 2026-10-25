-- The checked one-sentence home-page line and the optional "why it matters" line (JSON: { text, cites }).
ALTER TABLE stories ADD COLUMN dek TEXT;
ALTER TABLE stories ADD COLUMN why TEXT;
