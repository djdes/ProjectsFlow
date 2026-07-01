-- commit-sync — ежедневная авто-обработка коммитов через claude -p (тратит подписку).
-- Раньше метерилась/гейтилась на dispatcher_user_id (админ, безлимит) → бесплатный расход
-- подписки для того, кто включил автоматизацию. created_by = владелец проекта (кто включил
-- автоматизацию у себя): на его тариф метерим и по нему гейтим (free/over-limit → не запустим).
ALTER TABLE commit_sync_jobs
  ADD COLUMN created_by CHAR(36) NULL AFTER project_id;
