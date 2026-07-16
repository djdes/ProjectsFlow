-- Telegram-сводка: группировка задач по ответственным и уборка предыдущего ручного теста.
ALTER TABLE project_digest_settings
  ADD COLUMN daily_tg_grouping VARCHAR(16) NOT NULL DEFAULT 'status' AFTER daily_tg_targets,
  ADD COLUMN daily_test_deliveries JSON NULL AFTER daily_last_sent_on;
