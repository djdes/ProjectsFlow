ALTER TABLE project_automation
  ADD COLUMN assignee_digest_enabled BOOLEAN NOT NULL DEFAULT FALSE AFTER daily_plan_enabled;

CREATE TABLE workspace_assignee_digest_settings (
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
  CONSTRAINT fk_workspace_assignee_digest_workspace
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX idx_workspace_assignee_digest_enabled
  ON workspace_assignee_digest_settings (enabled);
