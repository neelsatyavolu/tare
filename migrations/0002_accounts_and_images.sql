-- Accounts are the subscribers table (email = identity, no passwords). Once the address is confirmed
-- the row is 'active' (gets the daily email) or 'unsubscribed' (account kept, no email).
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,      -- sha-256 of the cookie value
  subscriber_id TEXT NOT NULL REFERENCES subscribers (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_subscriber ON sessions (subscriber_id);


-- Photos: the outlet's own feed image for each item, and the one a story shows (credited to its outlet).
ALTER TABLE items ADD COLUMN image_url TEXT;
ALTER TABLE stories ADD COLUMN image_item_id TEXT;
