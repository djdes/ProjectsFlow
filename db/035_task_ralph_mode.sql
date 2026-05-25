-- db/035_task_ralph_mode.sql
-- Режим работы Ralph по конкретной задаче. Автор задачи задаёт при создании или
-- меняет позже. См. spec C:/www/ralph/prompts/task-ralph-mode.md.
--   'normal'  (default) — текущее поведение: worker может задать ralph-question,
--                         pre-worker grillme — только по триггерам.
--   'silent'           — worker НЕ задаёт вопросов; при неясности сразу blocked.
--   'grillme'          — принудительно запускается pre-worker grillme (до 10 вопросов
--                         batch'ом), затем worker как 'normal'.
-- VARCHAR(16) (не enum) — forward-compat под будущие режимы без миграции.
-- DEFAULT 'normal' NOT NULL — все исторические задачи получают дефолт без UPDATE.

ALTER TABLE tasks
  ADD COLUMN ralph_mode VARCHAR(16) NOT NULL DEFAULT 'normal';
