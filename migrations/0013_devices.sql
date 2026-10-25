-- iOS devices registered for push notifications, keyed by their APNs token. No account is needed: the token
-- and its notification choices are all Tare keeps. Tokens APNs reports as gone are deleted.
CREATE TABLE devices (
  token TEXT PRIMARY KEY,
  environment TEXT NOT NULL DEFAULT 'production',
  editions TEXT NOT NULL DEFAULT 'both',
  breaking INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- Stories already pushed as breaking news, so each goes out once.
CREATE TABLE pushed_stories (
  story_id TEXT PRIMARY KEY,
  pushed_at INTEGER NOT NULL
);
