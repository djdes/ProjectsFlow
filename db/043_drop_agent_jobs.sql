-- db/043_drop_agent_jobs.sql
-- Удаляем feature «Передать агенту» — она не работает в реальной архитектуре
-- (dispatch.ps1 не использует agent_jobs queue, поллит все todo/in_progress напрямую).
--
-- Что было: миграции 014 (agent_jobs) и 015 (tasks.delegated_to_agent). UI-кнопка
-- «робот» на TODO-карточке создавала agent_jobs row + ставила sticky-флаг.
--
-- Что остаётся: agent-токены (agent_tokens), MCP, dispatch.ps1 — продолжают работать
-- через прямой REST-poll задач. Новая фича AI-prompt-improvement (db/042) — тоже не
-- затрагивается.

DROP TABLE IF EXISTS agent_jobs;

ALTER TABLE tasks DROP COLUMN delegated_to_agent;
