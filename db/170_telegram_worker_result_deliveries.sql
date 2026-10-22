-- Each successful worker run has its own durable delivery. The intake destination
-- remains independent of the outbox, so follow-up work can be reported again.
CREATE TABLE IF NOT EXISTS telegram_worker_result_deliveries (
  id CHAR(36) NOT NULL PRIMARY KEY,
  task_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  completion_key VARCHAR(64) NOT NULL,
  source VARCHAR(16) NOT NULL,
  tg_chat_id BIGINT NOT NULL,
  tg_message_id BIGINT NULL,
  requested_at TIMESTAMP NOT NULL,
  sent_at TIMESTAMP NULL DEFAULT NULL,
  retry_at TIMESTAMP NULL DEFAULT NULL,
  claim_token CHAR(36) NULL,
  claim_until TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY uq_twrd_completion (task_id, completion_key),
  KEY idx_twrd_due (sent_at, retry_at, requested_at),
  CONSTRAINT fk_twrd_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
