-- Generalized incoming Telegram media plus an idempotency key for source messages/albums.
-- Both columns are nullable for rolling-deploy compatibility with drafts created by older code.
-- `attachments IS NULL` means "read legacy photos"; an explicit JSON [] means "no files".

ALTER TABLE telegram_task_drafts
  ADD COLUMN attachments JSON NULL AFTER photos,
  ADD COLUMN source_key VARCHAR(191) NULL AFTER tg_message_id,
  ADD UNIQUE INDEX uq_ttd_source_key (source_key);
