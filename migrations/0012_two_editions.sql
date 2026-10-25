-- Morning and evening editions. Each reader picks which they get (both by default). last_sent_date now holds the
-- last edition sent, "YYYY-MM-DD-am" or "YYYY-MM-DD-pm", which sorts in send order; old plain dates were mornings.
ALTER TABLE subscribers ADD COLUMN editions TEXT NOT NULL DEFAULT 'both';
UPDATE subscribers SET last_sent_date = last_sent_date || '-am' WHERE last_sent_date IS NOT NULL AND length(last_sent_date) = 10;
