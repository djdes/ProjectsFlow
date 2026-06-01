-- db/051_server_snapshots.sql
-- Time-series снимки метрик сервера. Гибрид: полный payload в metrics JSON +
-- вынесенные числовые колонки для дешёвых трендовых выборок и индексов.
-- Пишут: интервальный local-collect (source='local') и агент-ingest (source='agent').
-- logs — редактированные (секреты выскоблены) и усечённые хвосты. Сырые логи в KB НЕ попадают.
CREATE TABLE IF NOT EXISTS server_snapshots (
  id                  CHAR(36)                NOT NULL,
  server_id           CHAR(36)                NOT NULL,
  -- Денормализован для дешёвых scoped-выборок и access-чека без джойна.
  project_id          CHAR(36)                NOT NULL,
  collected_at        TIMESTAMP               NOT NULL,
  source              ENUM('local','agent')   NOT NULL,
  status              VARCHAR(16)             NOT NULL,  -- ok | degraded | down | stale
  reachable           BOOLEAN                 NOT NULL DEFAULT TRUE,
  -- Полный структурированный payload (pm2[], system{}, disk{}, ...).
  metrics             JSON                    NULL,
  -- { pm2Out, pm2Err, nginxAccess, nginxError } — каждый string|null, редактирован+усечён.
  logs                JSON                    NULL,
  -- Бонус: метрики БД (соединения/размер), если собраны.
  db_health           JSON                    NULL,
  -- Ошибки сбора (недоступные источники, EACCES и т.п.).
  errors              JSON                    NULL,
  -- Вынесенные числовые колонки для трендов/индексов.
  cpu_load1           DOUBLE                  NULL,
  cpu_load5           DOUBLE                  NULL,
  cpu_load15          DOUBLE                  NULL,
  mem_used_pct        DOUBLE                  NULL,
  disk_used_pct       DOUBLE                  NULL,
  pm2_online          TINYINT                 NULL,  -- сколько процессов online
  pm2_restart_total   INT                     NULL,
  -- Форензика: кто запушил (для source='agent').
  pushed_by_user_id   CHAR(36)                NULL,
  agent_token_id      CHAR(36)                NULL,
  created_at          TIMESTAMP               NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Дедуп/анти-реплей: один снимок на (сервер, момент сбора).
  UNIQUE KEY uq_snapshot_server_time (server_id, collected_at),
  KEY idx_snapshot_server_time (server_id, collected_at),
  KEY idx_snapshot_project_time (project_id, collected_at),
  KEY idx_snapshot_collected (collected_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
