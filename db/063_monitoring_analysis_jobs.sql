-- db/063_monitoring_analysis_jobs.sql
-- AI-анализ мониторинга через диспетчера. Зеркало ai_prompt_jobs (db/042/060): сайт кладёт
-- job с ПРЕД-СОБРАННЫМ контекстом (снимок/логи/алерты/тренд), Ralph-диспетчер пикапит через
-- MCP, анализирует через Claude и возвращает markdown-отчёт. Web long-poll'ит результат.
CREATE TABLE IF NOT EXISTS monitoring_analysis_jobs (
  id                  CHAR(36)        NOT NULL,
  created_by          CHAR(36)        NOT NULL,
  -- В отличие от ai_prompt_jobs, анализ всегда про сервер проекта → оба NOT NULL.
  project_id          CHAR(36)        NOT NULL,
  server_id           CHAR(36)        NOT NULL,
  -- Денормализованный диспетчер (на момент enqueue) — Ralph поллит по индексу без join.
  dispatcher_user_id  CHAR(36)        NOT NULL,
  status              ENUM('queued','running','succeeded','failed','cancelled')
                                      NOT NULL DEFAULT 'queued',
  -- snapshot | logs | alert | digest — Ralph по нему выбирает фокус/промпт.
  analysis_type       ENUM('snapshot','logs','alert','digest') NOT NULL DEFAULT 'snapshot',
  -- Для analysis_type='alert': какой алерт инициировал. Дедуп авто-анализа + подсветка в UI.
  alert_id            CHAR(36)        NULL,
  -- ПРЕД-СОБРАННЫЙ контекст (markdown): сервер, последний снимок, активные алерты, хвосты
  -- логов (для logs/alert), недавний тренд. Всё, что нужно Claude — без до-запросов.
  context             MEDIUMTEXT      NULL,
  -- Опц. свободный вопрос/заметка пользователя к анализу.
  note                TEXT            NULL,
  -- Результат — markdown-отчёт (рендерим через CommentBody). NULL пока не succeeded.
  result_markdown     MEDIUMTEXT      NULL,
  error               VARCHAR(500)    NULL,
  -- Стоимость/токены прогона (как в live_sessions) — UI показывает «во сколько обошёлся анализ».
  cost_usd            DECIMAL(10,4)   NULL,
  tokens_in           BIGINT          NULL,
  tokens_out          BIGINT          NULL,
  claimed_at          TIMESTAMP       NULL,
  finished_at         TIMESTAMP       NULL,
  created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_maj_dispatcher_status (dispatcher_user_id, status, created_at),
  KEY idx_maj_server_created (server_id, created_at),
  KEY idx_maj_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
