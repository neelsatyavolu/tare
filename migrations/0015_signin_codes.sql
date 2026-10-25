-- One-time sign-in codes for the iOS app, which can't follow an emailed link into itself. Only a hash is kept.
CREATE TABLE signin_codes (
  subscriber_id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
