-- db/061_automation_publish_settings.sql
-- Настройки публикации/деплоя воркера автоматизации (per-project). Дополняют
-- project_automation (db/045). Диспетчер (ralph) читает их через /agent/* и применяет
-- к каждому прогону воркера:
--   A) git_author_* — от чьего имени воркер коммитит (бот / владелец / кастом);
--   B) ignore_claude_md — обходить commit-ритуал CLAUDE.md проекта (без Co-Authored-By);
--   C) ultracode_review_enabled — блокирующая Opus-проверка совместимости перед push;
--   D) deploy_method/deploy_command — как деплоить после успешной задачи.
-- Дефолты воспроизводят сегодняшнее поведение (бот-автор + ритуал ON + github_auto).

ALTER TABLE project_automation
  ADD COLUMN IF NOT EXISTS git_author_mode          ENUM('bot','owner','custom')              NOT NULL DEFAULT 'bot'         AFTER ralph_mode,
  ADD COLUMN IF NOT EXISTS git_author_name          VARCHAR(120)                              NULL                           AFTER git_author_mode,
  ADD COLUMN IF NOT EXISTS git_author_email         VARCHAR(254)                              NULL                           AFTER git_author_name,
  ADD COLUMN IF NOT EXISTS ignore_claude_md         BOOLEAN                                   NOT NULL DEFAULT FALSE         AFTER git_author_email,
  ADD COLUMN IF NOT EXISTS ultracode_review_enabled BOOLEAN                                   NOT NULL DEFAULT FALSE         AFTER ignore_claude_md,
  ADD COLUMN IF NOT EXISTS deploy_method            ENUM('github_auto','ssh_manual','none')  NOT NULL DEFAULT 'github_auto' AFTER ultracode_review_enabled,
  ADD COLUMN IF NOT EXISTS deploy_command           VARCHAR(500)                              NULL                           AFTER deploy_method;
