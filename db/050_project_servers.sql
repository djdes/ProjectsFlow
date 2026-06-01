-- db/050_project_servers.sql
-- Серверы проекта для мониторинга (pm2 / nginx / диск / система).
-- kind='local' — VPS, на котором крутится сам бэкенд PF: читается напрямую (pm2 jlist, df, os).
-- kind='remote' — удалённый сервер: метрики собирает Ralph-стиль сборщик по SSH и пушит снимки.
-- SSH-ключи в PF НЕ хранятся: ssh_credential_ref — непрозрачная метка, которую сборщик
-- интерпретирует локально (его SSH-config/agent). См. spec server-monitoring-design.md.
CREATE TABLE IF NOT EXISTS project_servers (
  id                     CHAR(36)                      NOT NULL,
  project_id             CHAR(36)                      NOT NULL,
  name                   VARCHAR(120)                  NOT NULL,
  kind                   ENUM('local','remote')        NOT NULL DEFAULT 'remote',
  -- Метаданные подключения (НЕ секреты). Для local host/ssh_* не используются.
  host                   VARCHAR(255)                  NULL,
  ssh_port               INT                           NOT NULL DEFAULT 22,
  ssh_user               VARCHAR(120)                  NULL,
  -- Непрозрачная ссылка на креды, резолвится сборщиком на его машине (НЕ секрет PF).
  ssh_credential_ref     VARCHAR(500)                  NULL,
  -- Имена pm2-процессов для фильтра (JSON-массив строк); NULL = все процессы.
  pm2_process_names      JSON                          NULL,
  -- Пути логов. Для local задаются админом/env (защита от path-traversal на прод-хосте).
  nginx_access_log_path  VARCHAR(500)                  NULL,
  nginx_error_log_path   VARCHAR(500)                  NULL,
  deploy_path            VARCHAR(500)                  NULL,
  enabled                BOOLEAN                       NOT NULL DEFAULT TRUE,
  collect_interval_seconds INT                         NOT NULL DEFAULT 300,
  -- Денормализованная сводка последнего снимка (для списка без джойна).
  last_snapshot_at       TIMESTAMP                     NULL,
  last_status            VARCHAR(16)                   NULL,  -- ok | degraded | down | stale
  created_at             TIMESTAMP                     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP                     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                       ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_project_server_name (project_id, name),
  KEY idx_project_server_project_kind (project_id, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
