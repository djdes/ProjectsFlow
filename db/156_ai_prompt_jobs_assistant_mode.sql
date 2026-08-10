-- db/156_ai_prompt_jobs_assistant_mode.sql
-- Режим 'assistant': невидимая очередь для запросов ИИ-ассистентов продуктов (DocsFlow, ScanFlow).
--
-- Раньше DocsFlow/ScanFlow на каждый запрос пользователя создавали ОБЫЧНУЮ задачу в своём
-- проекте (POST /agent/projects/:id/tasks) — это была их очередь для диспетчера. Карточки
-- засоряли канбан, а показывать их не нужно вовсе. Теперь продукты кладут тот же
-- самодостаточный инструкционный текст (frontmatter + шаги) в ai_prompt_jobs с mode='assistant':
-- enqueue → pending → claim → complete, карточек нет, терминальные записи чистятся через 7 дней.
--
-- Добавляем значение в конец ENUM — на MariaDB/MySQL это INSTANT-операция (метаданные,
-- без перестройки таблицы и без блокировки). Существующие строки не затрагиваются.
ALTER TABLE ai_prompt_jobs
  MODIFY COLUMN mode ENUM('improve','compose','compose-advanced','assistant') NOT NULL DEFAULT 'improve';
