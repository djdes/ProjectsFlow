-- db/042_ai_prompt_jobs.sql
-- Очередь AI-промпт-улучшений: сайт кладёт job, Ralph-диспетчер пикапит
-- через MCP и возвращает улучшенный текст.
-- См. docs/superpowers/specs/2026-05-28-ai-prompt-improvement-design.md

CREATE TABLE IF NOT EXISTS ai_prompt_jobs (
  id                  CHAR(36)                                                NOT NULL,
  created_by          CHAR(36)                                                NOT NULL,
  -- NULL = задача для Inbox / без проекта; назначенный dispatcher_user_id берётся
  -- из дефолтного env'а (AI_PROMPT_DEFAULT_DISPATCHER_EMAIL).
  project_id          CHAR(36)                                                NULL,
  -- Денормализация: на момент enqueue запоминаем, кто диспетчер. Так Ralph при
  -- поллинге делает один индексный лукап без join'а с projects.
  dispatcher_user_id  CHAR(36)                                                NOT NULL,
  status              ENUM('queued','running','succeeded','failed','cancelled')
                                                                              NOT NULL DEFAULT 'queued',
  -- Исходный текст 1..5000 символов (validated на API).
  input_text          TEXT                                                    NOT NULL,
  -- Пре-собранный KB-контекст. NULL если проекта нет или у проекта нет KB.
  -- MEDIUMTEXT, потому что суммарный лимит 30000 символов помещается в TEXT,
  -- но запас не помешает (например, если в будущем подняли лимит).
  kb_context          MEDIUMTEXT                                              NULL,
  -- Результат от Ralph'а. NULL пока status != 'succeeded'.
  improved_text       TEXT                                                    NULL,
  -- Короткое описание ошибки. NULL если status != 'failed'/'cancelled'.
  error               VARCHAR(500)                                            NULL,
  claimed_at          TIMESTAMP                                               NULL,
  finished_at         TIMESTAMP                                               NULL,
  created_at          TIMESTAMP                                               NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP                                               NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                                              ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Главный poll-индекс для Ralph'а: «мои queued по возрастанию времени».
  KEY idx_ai_prompt_jobs_dispatcher_status (dispatcher_user_id, status, created_at),
  -- Cleanup истёкших + поиск по status.
  KEY idx_ai_prompt_jobs_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
