-- Readers can let their connected AI account write briefings for front-page stories on its own (off by
-- default). Automatic requests are marked so they count against that allowance and not against asking.
ALTER TABLE ai_connections ADD COLUMN auto_briefings INTEGER NOT NULL DEFAULT 0;
ALTER TABLE briefings ADD COLUMN auto INTEGER NOT NULL DEFAULT 0;
