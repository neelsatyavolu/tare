-- Artificial intelligence moved out of Technology into its own section (classify_version 4). Readers who
-- followed Technology used to get AI stories there, so they now follow the new section too; they can drop it.
UPDATE subscribers SET topics = json_insert(topics, '$[#]', 'ai')
WHERE EXISTS (SELECT 1 FROM json_each(subscribers.topics) WHERE value = 'tech')
  AND NOT EXISTS (SELECT 1 FROM json_each(subscribers.topics) WHERE value = 'ai');
