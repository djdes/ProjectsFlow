-- Workspace-owned Telegram schedule. The same group and project scope are shared by
-- the assignee digest, the 17:00 commit check, and the 17:20 end-of-day reminder.
ALTER TABLE workspace_assignee_digest_settings
  ADD COLUMN project_mode ENUM('all', 'selected') NOT NULL DEFAULT 'all' AFTER recipient_user_ids,
  ADD COLUMN project_ids JSON NULL AFTER project_mode,
  ADD COLUMN commit_sync_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER project_ids,
  ADD COLUMN commit_sync_hour TINYINT UNSIGNED NOT NULL DEFAULT 17 AFTER commit_sync_enabled,
  ADD COLUMN commit_sync_minute TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER commit_sync_hour,
  ADD COLUMN commit_sync_last_sent_on DATE NULL AFTER commit_sync_minute,
  ADD COLUMN eod_reminder_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER commit_sync_last_sent_on,
  ADD COLUMN eod_reminder_hour TINYINT UNSIGNED NOT NULL DEFAULT 17 AFTER eod_reminder_enabled,
  ADD COLUMN eod_reminder_minute TINYINT UNSIGNED NOT NULL DEFAULT 20 AFTER eod_reminder_hour,
  ADD COLUMN eod_reminder_last_sent_on DATE NULL AFTER eod_reminder_minute;

CREATE INDEX idx_workspace_telegram_schedule
  ON workspace_assignee_digest_settings (commit_sync_enabled, eod_reminder_enabled);
