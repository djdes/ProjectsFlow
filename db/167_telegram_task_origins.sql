-- Preserve the Telegram destination independently of expiring drafts and reply mappings.
-- Result delivery is an outbox: failed sends survive process restarts; claims prevent
-- simultaneous sends by multiple API processes.
CREATE TABLE IF NOT EXISTS telegram_task_origins (
  task_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  tg_chat_id BIGINT NOT NULL,
  tg_message_id BIGINT NULL,
  requested_at TIMESTAMP NULL DEFAULT NULL,
  sent_at TIMESTAMP NULL DEFAULT NULL,
  retry_at TIMESTAMP NULL DEFAULT NULL,
  claim_token CHAR(36) NULL,
  claim_until TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (task_id),
  KEY idx_tto_due (sent_at, retry_at, requested_at),
  CONSTRAINT fk_tto_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
