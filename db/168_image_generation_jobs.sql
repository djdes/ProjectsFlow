CREATE TABLE IF NOT EXISTS image_generation_jobs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  dispatcher_user_id CHAR(36) NOT NULL,
  prompt TEXT NOT NULL,
  status ENUM('queued','running','succeeded','failed') NOT NULL DEFAULT 'queued',
  claim_token CHAR(36) NULL,
  storage_key VARCHAR(255) NULL,
  error_message VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  started_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  INDEX image_jobs_owner (user_id, created_at),
  INDEX image_jobs_queue (dispatcher_user_id, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
