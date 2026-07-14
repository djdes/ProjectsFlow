-- Надёжное автосоздание Telegram-черновиков и сохранение входящих фото.
-- auto_create_at остаётся NULL у старых черновиков: автоматически создаются только новые.

ALTER TABLE telegram_task_drafts
  MODIFY COLUMN status ENUM('composing', 'confirming', 'confirmed', 'cancelled', 'expired')
    NOT NULL DEFAULT 'composing',
  ADD COLUMN photos JSON NULL AFTER segments,
  ADD COLUMN tg_message_id BIGINT NULL AFTER tg_chat_id,
  ADD COLUMN auto_create_at TIMESTAMP NULL DEFAULT NULL AFTER created_at,
  ADD COLUMN confirmation_started_at TIMESTAMP NULL DEFAULT NULL AFTER auto_create_at,
  ADD INDEX idx_ttd_auto_create (status, auto_create_at);
