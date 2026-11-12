-- Sign in with a Xanom account (accounts.xanom.co). xanom_sub is the account's OIDC subject; xanom_email is the
-- address on that account, shown on the account page (it can differ from the Tare address after a link).
ALTER TABLE subscribers ADD COLUMN xanom_sub TEXT;
ALTER TABLE subscribers ADD COLUMN xanom_email TEXT;
CREATE UNIQUE INDEX subscribers_xanom_sub ON subscribers (xanom_sub);

-- One-time handoffs for the iOS app, which signs in through a browser sheet that has no Tare cookie.
-- 'ios_start' carries the signed-in reader into a link/convert flow; 'ios_ticket' carries the result back
-- to the app, which swaps it for a session. Only a hash is kept; each works once and for a minute or two.
-- A ticket also carries the S256 challenge of a verifier the app made when it opened the sheet, so only that
-- app can redeem it (like PKCE).
CREATE TABLE xanom_handoffs (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('ios_start', 'ios_ticket')),
  subscriber_id TEXT NOT NULL REFERENCES subscribers (id) ON DELETE CASCADE,
  intent TEXT,
  created INTEGER NOT NULL DEFAULT 0,
  challenge TEXT,
  expires_at INTEGER NOT NULL
);
