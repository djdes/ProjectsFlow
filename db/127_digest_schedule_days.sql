-- Explicit per-day schedules replace the ambiguous weekdays_only switch.
-- Existing enabled automations are migrated to Mon-Fri so they stop firing on weekends.
-- New/inactive schedules start with all seven days selected.
ALTER TABLE project_digest_settings
  ADD COLUMN daily_days_of_week JSON NULL AFTER daily_weekdays_only;

UPDATE project_digest_settings
SET daily_days_of_week = CASE
  WHEN daily_enabled = 1 OR daily_weekdays_only = 1 THEN JSON_ARRAY(1, 2, 3, 4, 5)
  ELSE JSON_ARRAY(1, 2, 3, 4, 5, 6, 0)
END
WHERE daily_days_of_week IS NULL;

ALTER TABLE workspace_assignee_digest_settings
  ADD COLUMN days_of_week JSON NULL AFTER weekdays_only;

UPDATE workspace_assignee_digest_settings
SET days_of_week = CASE
  WHEN enabled = 1 OR commit_sync_enabled = 1 OR eod_reminder_enabled = 1
    THEN JSON_ARRAY(1, 2, 3, 4, 5)
  ELSE JSON_ARRAY(1, 2, 3, 4, 5, 6, 0)
END
WHERE days_of_week IS NULL;
