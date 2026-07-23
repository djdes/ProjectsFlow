-- 142_commit_sync_optin_docsflow.sql
-- Разовая data-миграция: делаем ежедневную сверку коммитов opt-in.
--
-- Контекст: db/101 выставил project_automation.commit_sync_enabled DEFAULT TRUE и back-fill'ом
-- включил сверку у всех проектов (17:00). Пока сверкой владел workspace-планировщик (гейт по
-- assignee-digest пространства), боевыми были лишь проекты в настроенных пространствах.
-- Часть 2 сделала per-project CommitSyncScheduler боевым — теперь запускаются ВСЕ проекты с
-- commit_sync_enabled=1 и диспетчером (на проде их 36), каждый шлёт ежедневную Telegram-сводку.
--
-- Владелец хочет обкатать сверку сначала ТОЛЬКО на DocsFlow, остальные включит вручную
-- (per-project тумблером в окне автоматизации или мастер-кнопкой пространства «Применить ко всем»).

-- 1) Новые проекты больше НЕ включают сверку по умолчанию (opt-in вместо opt-out).
ALTER TABLE project_automation
  ALTER commit_sync_enabled SET DEFAULT FALSE;

-- 2) Выключаем сверку у всех существующих проектов, КРОМЕ DocsFlow (обкатка на одном проекте).
UPDATE project_automation
SET commit_sync_enabled = 0
WHERE project_id <> 'd526b619-7c17-4a8d-b860-dc611eb3de13';
