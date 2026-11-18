-- db/188_task_run_mode.sql
-- Режим запуска воркера по задаче (spec 2026-11-17 «telegram-group-projects-and-worker-
-- orchestrator», §5 «Режим запуска выбирает человек на каждой задаче»).
--   'quick' (default) — «Обычное изменение»: исполнитель без ревьюера, как раньше.
--   'full'            — «Полный прогон»: проверки, ревьюер, эскалация, доставка.
-- VARCHAR(16) (не enum) — как ralph_mode (db/035), forward-compat без миграции.
-- DEFAULT 'quick' NOT NULL — исторические задачи получают дефолт без UPDATE.

ALTER TABLE tasks
  ADD COLUMN run_mode VARCHAR(16) NOT NULL DEFAULT 'quick';
