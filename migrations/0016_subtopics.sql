-- A narrower topic within a section (Formula 1 in sports, AI policy in ai), when one fits. Remembered on items
-- with the section and importance (classify_version 4 rates them again), and carried onto stories.
ALTER TABLE items ADD COLUMN subtopic TEXT;
ALTER TABLE stories ADD COLUMN subtopic TEXT;
