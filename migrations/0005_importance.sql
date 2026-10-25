-- How much a story matters (1-5, from the published rubric in src/build/classify.ts), remembered per item so
-- hourly builds only rate new events, and stored on stories for ordering the front page.
ALTER TABLE items ADD COLUMN importance INTEGER;
ALTER TABLE stories ADD COLUMN importance INTEGER;
