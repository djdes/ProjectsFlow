-- Persist photo requests in the conversation where they were sent.
ALTER TABLE image_generation_jobs
  ADD COLUMN IF NOT EXISTS conversation_id CHAR(36) NULL,
  ADD INDEX IF NOT EXISTS image_jobs_conversation (user_id, conversation_id, created_at);
