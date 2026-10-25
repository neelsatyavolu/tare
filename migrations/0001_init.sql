-- Headlines and RSS descriptions only. Tare never stores article bodies.
CREATE TABLE items (
  id TEXT PRIMARY KEY,              -- sha-256 of the normalized link
  outlet_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  snippet TEXT NOT NULL DEFAULT '',
  published_at INTEGER NOT NULL,    -- ms since epoch; fetch time when the feed gives none
  fetched_at INTEGER NOT NULL
);
CREATE INDEX items_published ON items (published_at);

CREATE TABLE editions (
  date TEXT PRIMARY KEY,            -- YYYY-MM-DD (UTC)
  number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('building', 'ready', 'failed')),
  item_count INTEGER NOT NULL DEFAULT 0,
  built_at INTEGER,
  sent_at INTEGER,
  error TEXT
);

CREATE TABLE stories (
  id TEXT PRIMARY KEY,
  edition_date TEXT NOT NULL REFERENCES editions (date) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  front INTEGER NOT NULL DEFAULT 0, -- 1 when it is on the front page (sent to every subscriber)
  topic TEXT NOT NULL,
  headline TEXT NOT NULL,
  summary TEXT NOT NULL,            -- JSON: [{ text, cites: [itemId] }]
  differences TEXT NOT NULL,        -- JSON: [{ kind, text, cites: [itemId] }]
  coverage TEXT NOT NULL,           -- JSON: { left, center, right, total, balance }
  blindspot TEXT,                   -- 'left' | 'right' | NULL: the side that mostly skipped it
  item_ids TEXT NOT NULL            -- JSON: [itemId]
);
CREATE INDEX stories_edition ON stories (edition_date, rank);

CREATE TABLE subscribers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  topics TEXT NOT NULL,             -- JSON: [topicId]
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'unsubscribed')),
  created_at INTEGER NOT NULL,
  confirm_sent_at INTEGER,
  confirmed_at INTEGER,
  last_sent_date TEXT
);
CREATE INDEX subscribers_status ON subscribers (status);
