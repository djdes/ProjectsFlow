-- 136: durable administrative audit journal for the application Data Explorer.
--
-- Administrative disclosure events (secret reveal / CSV export / sensitivity flag changes /
-- runtime-user listing, and every project-member CRUD action) live HERE, in the platform's
-- trusted MariaDB — NOT in the per-project SQLite `_audit_log` that the untrusted public
-- App Runtime fills on every end-user request and that is truncated to the last 2000 events.
--
-- Keeping disclosure records in this append-only journal, which application traffic never
-- writes to and never evicts, restores the guarantee the whole masking design rests on:
-- "revealing a secret ALWAYS leaves a trace". An editor can no longer flush reveal/export
-- records out of the log with ~2000 cheap reads.
--
-- created_at is stored as an ISO-8601 millisecond string (same format the SQLite journal
-- emits) so the two journals can be merged by timestamp in the unified logs viewer.
CREATE TABLE IF NOT EXISTS app_admin_audit_log (
  seq         BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  id          CHAR(36)     NOT NULL,
  project_id  CHAR(36)     NOT NULL,
  actor_type  VARCHAR(32)  NOT NULL,
  actor_id    VARCHAR(64),
  operation   VARCHAR(80)  NOT NULL,
  table_name  VARCHAR(64),
  row_id      VARCHAR(128),
  success     TINYINT(1)   NOT NULL DEFAULT 1,
  detail_json MEDIUMTEXT,
  created_at  VARCHAR(32)  NOT NULL,
  UNIQUE KEY uq_app_admin_audit_id (id),
  KEY idx_app_admin_audit_project_seq (project_id, seq),
  KEY idx_app_admin_audit_project_op (project_id, operation),
  KEY idx_app_admin_audit_project_table (project_id, table_name),
  KEY idx_app_admin_audit_project_actor (project_id, actor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
