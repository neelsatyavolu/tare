-- Each reader gets the editions at 7 a.m. and 6 p.m. in their own time zone (IANA name, detected from their
-- connection or sent by the app). NULL means Eastern. Devices also remember the last edition pushed to them.
ALTER TABLE subscribers ADD COLUMN timezone TEXT;
ALTER TABLE devices ADD COLUMN timezone TEXT;
ALTER TABLE devices ADD COLUMN last_edition_key TEXT;
