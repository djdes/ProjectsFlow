-- db/068_telegram_draft_target_status.sql
-- Выбор колонки канбана при создании задачи из Telegram-бота. Дефолт — 'backlog' (ЧЕРНОВИКИ);
-- пользователь может выбрать колонку перед созданием. Для AI-флоу колонка хранится per-segment
-- в JSON-колонке segments (segments[].targetStatus). Для РУЧНОГО (одиночного) флоу нужен
-- top-level столбец. Хранится канонический ключ статуса (backlog/manual/todo/done); имя
-- колонки резолвится под проект при рендере. NULL = дефолт 'backlog'.
-- См. spec docs/superpowers/specs/2026-06-08-telegram-bot-column-picker-design.md.
ALTER TABLE telegram_task_drafts
  ADD COLUMN IF NOT EXISTS target_status VARCHAR(20) NULL AFTER segments;
