-- 053_live_sessions.sql — LIVE-вкладка задачи: стрим действий Ralph-воркера (Cursor-style).
-- Аддитивно: одна новая таблица live_sessions (метаданные/статус/база seq/стоимость) + nullable
-- session_id в существующей task_progress_events (события переиспользуют ту же ленту).
-- Финальный git-дифф — это события (kind='file_diff'/'diff_summary'), не отдельная таблица.
-- См. план effervescent-sleeping-parasol (§1-2).

-- Сессия одного прогона воркера по задаче. base_seq — стартовый seq (MAX(seq for task)+1),
-- last_seq/event_count — для replay/прогресса. expires_at — lazy-GC retention.
CREATE TABLE IF NOT EXISTS live_sessions (
  id           CHAR(36)        NOT NULL,
  project_id   CHAR(36)        NOT NULL,
  task_id      CHAR(36)        NOT NULL,
  agent_name   VARCHAR(64)     NULL,
  attempt      INT             NOT NULL DEFAULT 1,
  status       ENUM('running','completed','failed','timeout','canceled') NOT NULL DEFAULT 'running',
  model        VARCHAR(64)     NULL,
  head_before  CHAR(40)        NULL,
  head_after   CHAR(40)        NULL,
  cost_usd     DECIMAL(10,4)   NULL,
  tokens_in    BIGINT          NULL,
  tokens_out   BIGINT          NULL,
  base_seq     INT             NOT NULL DEFAULT 0,
  last_seq     INT             NOT NULL DEFAULT 0,
  event_count  INT             NOT NULL DEFAULT 0,
  started_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at     TIMESTAMP       NULL,
  expires_at   TIMESTAMP       NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ls_task (task_id, started_at),
  KEY idx_ls_status (status),
  KEY idx_ls_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Привязка событий к сессии (события остаются в той же append-only task_progress_events).
ALTER TABLE task_progress_events
  ADD COLUMN session_id CHAR(36) NULL,
  ADD KEY idx_tpe_session (session_id, seq);
