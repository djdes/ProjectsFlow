-- db/067_telegram_draft_segments.sql
-- AI-перефраз сообщений бота: любое сообщение @ProjectsFlow_Bot прогоняется через простой/
-- быстрый compose (pass-1 sonnet), который режет текст на сегменты-задачи и проставляет
-- проект/исполнителя/дедлайн. Массив сегментов хранится в черновике между показом карточки
-- и нажатием «Создать». JSON-колонка (на MariaDB — алиас LONGTEXT; читается через
-- parseJsonCol). NULL = старый ручной флоу (без AI). См. spec
-- docs/superpowers/specs/2026-06-07-telegram-bot-ai-compose-design.md.
ALTER TABLE telegram_task_drafts
  ADD COLUMN IF NOT EXISTS segments JSON NULL AFTER offered;
