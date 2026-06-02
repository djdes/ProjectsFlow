-- db/060_ai_prompt_compose.sql
-- AI-compose режим: один job отдаёт ДВА варианта переработки текста («Простой» /
-- «Продвинутый») + разбивку на задачи с классификацией по проектам. Результат —
-- большая JSON-строка в improved_text. См. docs/superpowers/specs/ai-prompt-improvement-*.
--
-- 1) mode — дискриминатор: 'improve' (legacy, одиночное улучшение) | 'compose' (новое).
-- 2) improved_text TEXT(64KB) -> MEDIUMTEXT(16MB): структурированный результат с двумя
--    вариантами + сегментами легко превышает 64KB; cap на уровне приложения = 600000 симв.
-- 3) kb_context TEXT -> MEDIUMTEXT: для compose в него кладутся дайджесты ВСЕХ проектов-
--    кандидатов (до ~60K символов), что в utf8mb4 может вылезти за 64KB байт.
ALTER TABLE ai_prompt_jobs
  ADD COLUMN IF NOT EXISTS mode ENUM('improve','compose') NOT NULL DEFAULT 'improve' AFTER status;

ALTER TABLE ai_prompt_jobs MODIFY COLUMN improved_text MEDIUMTEXT NULL;

ALTER TABLE ai_prompt_jobs MODIFY COLUMN kb_context MEDIUMTEXT NULL;
