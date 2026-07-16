ALTER TABLE project_automation
  ADD COLUMN IF NOT EXISTS assignee_digest_enabled BOOLEAN NOT NULL DEFAULT FALSE AFTER daily_plan_enabled;

CREATE TABLE IF NOT EXISTS workspace_assignee_digest_settings (
  workspace_id CHAR(36) NOT NULL PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  send_hour TINYINT NOT NULL DEFAULT 9,
  send_minute TINYINT NOT NULL DEFAULT 0,
  weekdays_only BOOLEAN NOT NULL DEFAULT TRUE,
  telegram_group_chat_id BIGINT NULL,
  telegram_group_title VARCHAR(255) NULL,
  recipient_mode ENUM('all', 'selected') NOT NULL DEFAULT 'all',
  recipient_user_ids JSON NULL,
  last_sent_on DATE NULL,
  test_deliveries JSON NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_workspace_assignee_digest_enabled (enabled),
  CONSTRAINT fk_workspace_assignee_digest_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
