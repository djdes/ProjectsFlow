-- 044_file_sync.sql — подсистема кастомной (не-git) синхронизации папок (PF Desktop Companion).
-- Аддитивно: только новые таблицы, существующие не трогаются. Контент-адресуемые блобы + снепшоты
-- + change-set'ы + round-trip сессии + лента прогресса. См. дизайн humble-coalescing-oasis.

-- Воркспейс: одна на проект. base_version — CAS-страж указателя base (single-writer).
CREATE TABLE IF NOT EXISTS sync_workspaces (
  id                          CHAR(36)        NOT NULL,
  project_id                  CHAR(36)        NOT NULL,
  label                       VARCHAR(255)    NULL,
  base_snapshot_id            CHAR(36)        NULL,
  base_version                BIGINT UNSIGNED NOT NULL DEFAULT 0,
  dispatcher_head_snapshot_id CHAR(36)        NULL,
  ignore_set_json             JSON            NOT NULL,
  ignore_set_hash             CHAR(64)        NOT NULL,
  is_case_sensitive           TINYINT(1)      NOT NULL DEFAULT 0,
  client_protocol_version     INT             NOT NULL DEFAULT 1,
  pending_apply               TINYINT(1)      NOT NULL DEFAULT 0,
  quota_bytes                 BIGINT UNSIGNED NOT NULL DEFAULT 2147483648,
  used_bytes                  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at                  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sync_ws_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Контент-адресуемые блобы (дедуп по sha256). pinned_until защищает draft/in-flight блобы от GC.
CREATE TABLE IF NOT EXISTS sync_blobs (
  sha256       CHAR(64)        NOT NULL,
  size_bytes   BIGINT UNSIGNED NOT NULL,
  storage_key  VARCHAR(500)    NOT NULL,
  ref_count    INT UNSIGNED    NOT NULL DEFAULT 0,
  pinned_until  TIMESTAMP      NULL DEFAULT NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (sha256),
  KEY idx_sync_blobs_ref (ref_count),
  KEY idx_sync_blobs_pin (pinned_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Снепшоты: draft -> sealed. ignore_set_hash — хеш ignore-set, которым пользовался producer
-- (сервер отвергает result change-set, чьи удаления трогают исключённые пути).
CREATE TABLE IF NOT EXISTS sync_snapshots (
  id                 CHAR(36)        NOT NULL,
  workspace_id       CHAR(36)        NOT NULL,
  source             ENUM('client','dispatcher') NOT NULL,
  parent_snapshot_id CHAR(36)        NULL,
  task_id            CHAR(36)        NULL,
  status             ENUM('draft','sealed','aborted') NOT NULL DEFAULT 'draft',
  file_count         INT UNSIGNED    NOT NULL DEFAULT 0,
  total_bytes        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  manifest_sha       CHAR(64)        NULL,
  ignore_set_hash    CHAR(64)        NOT NULL,
  created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  sealed_at          TIMESTAMP       NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_sync_snap_ws (workspace_id),
  KEY idx_sync_snap_status (status),
  KEY idx_sync_snap_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Файловые записи снепшота. path_hash = sha256(path) для уникального ключа
-- (полный VARCHAR(1024) в utf8mb4 превышает лимит индекса InnoDB 3072 байта).
CREATE TABLE IF NOT EXISTS sync_file_entries (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  snapshot_id    CHAR(36)        NOT NULL,
  path           VARCHAR(1024)   NOT NULL,
  path_hash      CHAR(64)        NOT NULL,
  blob_sha       CHAR(64)        NULL,
  size_bytes     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  mode           INT UNSIGNED    NOT NULL DEFAULT 0,
  mtime_ms       BIGINT UNSIGNED NULL,
  is_symlink     TINYINT(1)      NOT NULL DEFAULT 0,
  symlink_target VARCHAR(1024)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sfe_snap_path (snapshot_id, path_hash),
  KEY idx_sfe_snap (snapshot_id),
  KEY idx_sfe_blob (blob_sha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Кэш диффа base->head (пересчитываемо, агрессивный GC).
CREATE TABLE IF NOT EXISTS sync_change_sets (
  id                CHAR(36)     NOT NULL,
  base_snapshot_id  CHAR(36)     NOT NULL,
  head_snapshot_id  CHAR(36)     NOT NULL,
  changes_json      JSON         NOT NULL,
  added_count       INT UNSIGNED NOT NULL DEFAULT 0,
  modified_count    INT UNSIGNED NOT NULL DEFAULT 0,
  deleted_count     INT UNSIGNED NOT NULL DEFAULT 0,
  created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_scs_base_head (base_snapshot_id, head_snapshot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Round-trip сессия: источник истины инварианта «результат применён или явно брошен».
CREATE TABLE IF NOT EXISTS sync_sessions (
  id                 CHAR(36) NOT NULL,
  workspace_id       CHAR(36) NOT NULL,
  task_id            CHAR(36) NULL,
  base_snapshot_id   CHAR(36) NOT NULL,
  result_snapshot_id CHAR(36) NULL,
  status   ENUM('uploaded','materialized','result_ready','applied','conflict','partial','aborted')
           NOT NULL DEFAULT 'uploaded',
  conflict_json      JSON         NULL,
  idempotency_key    VARCHAR(128) NULL,
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ss_ws (workspace_id),
  KEY idx_ss_task (task_id),
  KEY idx_ss_status (status),
  UNIQUE KEY uq_ss_idem (workspace_id, idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Лента прогресса задачи (append-only, идемпотентно на (task_id, seq)).
CREATE TABLE IF NOT EXISTS task_progress_events (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id     CHAR(36)        NOT NULL,
  project_id  CHAR(36)        NOT NULL,
  seq         INT UNSIGNED    NOT NULL,
  kind        VARCHAR(32)     NOT NULL,
  text        TEXT            NULL,
  payload     JSON            NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tpe_task_seq (task_id, seq),
  KEY idx_tpe_task (task_id),
  KEY idx_tpe_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
