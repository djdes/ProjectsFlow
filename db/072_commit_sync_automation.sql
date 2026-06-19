-- db/072_commit_sync_automation.sql
-- Ежедневная авто-обработка статусов задач по коммитам. Раз в день в выбранное время
-- сервер ставит job на проект (если включено); диспетчер (ralph) забирает её, спрашивает
-- Claude какие коммиты по смыслу относятся к задачам todo/in_progress, и репортит совпадения.
-- Порог и перемещения применяет сервер: коммит свежее порога → in_progress (из todo),
-- старше порога → done. См. план modular-launching-hollerith.md.

-- Конфиг живёт в существующей строке project_automation (db/045) — append-only ALTER.
ALTER TABLE project_automation
  ADD COLUMN commit_sync_enabled         BOOLEAN  NOT NULL DEFAULT FALSE,
  ADD COLUMN commit_sync_hour            TINYINT  NOT NULL DEFAULT 3,   -- 0..23 (Europe/Moscow)
  ADD COLUMN commit_sync_minute          TINYINT  NOT NULL DEFAULT 0,   -- 0..59
  ADD COLUMN commit_sync_threshold_hours INT      NOT NULL DEFAULT 70,  -- порог возраста коммита
  ADD COLUMN commit_sync_last_run_on     DATE     NULL;                 -- МSK-дата последнего прогона (анти-дубль)

-- Очередь задач commit-sync. Зеркало monitoring_analysis_jobs (db/063): сайт кладёт job с
-- ПРЕД-СОБРАННЫМ контекстом (задачи + коммиты + ageHours + порог), ralph пикапит через MCP/REST,
-- спрашивает Claude совпадения и возвращает matches. Перемещения применяет сервер при complete.
CREATE TABLE IF NOT EXISTS commit_sync_jobs (
  id                  CHAR(36)        NOT NULL,
  project_id          CHAR(36)        NOT NULL,
  -- Денормализованный диспетчер (на момент enqueue) — ralph поллит по индексу без join.
  dispatcher_user_id  CHAR(36)        NOT NULL,
  status              ENUM('queued','running','succeeded','failed','cancelled')
                                      NOT NULL DEFAULT 'queued',
  -- Снапшот порога на момент enqueue — авторитетен при применении (UI могли поменять позже).
  threshold_hours     INT             NOT NULL,
  -- ПРЕД-СОБРАННЫЙ контекст (markdown): задачи todo/in_progress + коммиты с ageHours + порог
  -- + JSON-схема ответа. Всё, что нужно Claude — без до-запросов.
  context             MEDIUMTEXT      NULL,
  -- Снимок sha → committedAt (JSON) на момент enqueue. При complete сервер считает ageHours
  -- по нему — не доверяя таймстемпам от модели и не ходя второй раз в GitHub.
  commits_json        MEDIUMTEXT      NULL,
  -- Совпадения от воркера: [{taskId, commitSha, reason}] (JSON). NULL пока не succeeded.
  matches_json        MEDIUMTEXT      NULL,
  -- Человекочитаемая сводка применённых перемещений (markdown).
  result_summary      MEDIUMTEXT      NULL,
  error               VARCHAR(500)    NULL,
  -- Стоимость/токены прогона (как в monitoring_analysis_jobs) — UI может показать цену.
  cost_usd            DECIMAL(10,4)   NULL,
  tokens_in           BIGINT          NULL,
  tokens_out          BIGINT          NULL,
  claimed_at          TIMESTAMP       NULL,
  finished_at         TIMESTAMP       NULL,
  created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_csj_dispatcher_status (dispatcher_user_id, status, created_at),
  KEY idx_csj_project_created (project_id, created_at),
  KEY idx_csj_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
