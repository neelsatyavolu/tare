-- A reader's connected ChatGPT or Grok account (shared-ai-auth), sealed with AES-GCM under AI_TOKEN_KEY.
CREATE TABLE ai_connections (
  subscriber_id TEXT PRIMARY KEY REFERENCES subscribers (id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('grok', 'codex')),
  sealed TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Detailed briefings, written on request with the requesting reader's AI account and then shown to everyone.
CREATE TABLE briefings (
  story_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('writing', 'ready', 'failed')),
  body TEXT,                        -- JSON: { sections: [{ heading, paragraphs: [{ text, cites }] }], web: [{ title, url }] }
  provider TEXT,
  requested_by TEXT,
  requested_at INTEGER NOT NULL,
  finished_at INTEGER,
  error TEXT
);
