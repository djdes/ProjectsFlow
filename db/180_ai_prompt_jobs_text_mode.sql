-- db/180_ai_prompt_jobs_text_mode.sql
-- Режим 'text': универсальный текстовый шлюз Codex (POST /api/ai/text-jobs).
--
-- Любой проект (или агент) присылает инструкцию + текст — «упрости», «напиши пост»,
-- «сократи до 300 символов». Сервер кладёт JSON-конверт {v, instructions, input} в
-- ai_prompt_jobs с mode='text', диспетчер Ralph исполняет его локальным `codex exec`
-- (подписка ChatGPT) в ai-job-worker.ps1, результат — в improved_text.
--
-- Значение добавляется в конец ENUM — на MariaDB это INSTANT-операция (только метаданные),
-- существующие строки не затрагиваются.
ALTER TABLE ai_prompt_jobs
  MODIFY COLUMN mode ENUM('improve','compose','compose-advanced','assistant','text') NOT NULL DEFAULT 'improve';
