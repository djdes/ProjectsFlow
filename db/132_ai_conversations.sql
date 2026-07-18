-- 132: durable private AI conversations and a dedicated worker queue.
-- This is intentionally separate from ai_prompt_jobs: terminal prompt jobs are
-- periodically deleted and cannot be used as conversation history.

CREATE TABLE IF NOT EXISTS ai_conversations (
  id                CHAR(36) NOT NULL,
  owner_user_id     CHAR(36) NOT NULL,
  workspace_id      CHAR(36) NULL,
  project_id        CHAR(36) NULL,
  kind              ENUM('personal', 'project_studio') NOT NULL,
  title             VARCHAR(120) NOT NULL,
  version           INT UNSIGNED NOT NULL DEFAULT 1,
  last_message_seq  BIGINT UNSIGNED NULL,
  last_message_at   DATETIME(3) NULL,
  archived_at       DATETIME(3) NULL,
  deleted_at        DATETIME(3) NULL,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_ai_conversations_owner_list
    (owner_user_id, archived_at, last_message_at),
  KEY idx_ai_conversations_owner_project
    (owner_user_id, project_id, kind, archived_at, last_message_at),
  KEY idx_ai_conversations_project (project_id, deleted_at, updated_at),
  CONSTRAINT fk_ai_conversations_owner FOREIGN KEY (owner_user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_conversations_workspace FOREIGN KEY (workspace_id)
    REFERENCES workspaces(id) ON DELETE SET NULL,
  CONSTRAINT fk_ai_conversations_project FOREIGN KEY (project_id)
    REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_conversation_messages (
  id                 CHAR(36) NOT NULL,
  seq                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id    CHAR(36) NOT NULL,
  role               ENUM('user', 'assistant', 'system', 'tool') NOT NULL,
  status             ENUM('queued', 'running', 'completed', 'failed', 'cancelled') NOT NULL,
  body               MEDIUMTEXT NOT NULL,
  parent_message_id  CHAR(36) NULL,
  client_request_id  CHAR(36) NULL,
  run_id             CHAR(36) NULL,
  model              VARCHAR(120) NULL,
  metadata_json      JSON NULL,
  error_code         VARCHAR(80) NULL,
  error_retryable    TINYINT(1) NOT NULL DEFAULT 0,
  deleted_at         DATETIME(3) NULL,
  created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                     ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ai_conversation_messages_seq (seq),
  UNIQUE KEY uq_ai_conversation_messages_client_request
    (conversation_id, client_request_id),
  KEY idx_ai_conversation_messages_conversation_seq (conversation_id, seq),
  KEY idx_ai_conversation_messages_run (run_id),
  CONSTRAINT fk_ai_conversation_messages_conversation FOREIGN KEY (conversation_id)
    REFERENCES ai_conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_conversation_messages_parent FOREIGN KEY (parent_message_id)
    REFERENCES ai_conversation_messages(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_conversation_runs (
  id                         CHAR(36) NOT NULL,
  conversation_id            CHAR(36) NOT NULL,
  project_id                 CHAR(36) NULL,
  dispatcher_user_id         CHAR(36) NOT NULL,
  user_message_id            CHAR(36) NOT NULL,
  assistant_message_id       CHAR(36) NOT NULL,
  mode                       ENUM('chat', 'studio_plan', 'studio_edit') NOT NULL,
  status                     ENUM('queued', 'claimed', 'running', 'completed', 'failed', 'cancelled')
                             NOT NULL DEFAULT 'queued',
  context_version            INT UNSIGNED NOT NULL DEFAULT 1,
  context_snapshot_json      JSON NULL,
  idempotency_key            VARCHAR(100) NOT NULL,
  completion_idempotency_key VARCHAR(100) NULL,
  lease_token_hash           CHAR(64) NULL,
  lease_expires_at           DATETIME(3) NULL,
  claimed_at                 DATETIME(3) NULL,
  project_edit_job_id        CHAR(36) NULL,
  model                      VARCHAR(120) NULL,
  tokens_in                  BIGINT NULL,
  tokens_out                 BIGINT NULL,
  cost_usd                   DECIMAL(12,6) NULL,
  error_code                 VARCHAR(80) NULL,
  error_message              VARCHAR(500) NULL,
  created_at                 DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  started_at                 DATETIME(3) NULL,
  finished_at                DATETIME(3) NULL,
  updated_at                 DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                             ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ai_conversation_runs_idempotency (conversation_id, idempotency_key),
  KEY idx_ai_conversation_runs_dispatcher (dispatcher_user_id, status, created_at),
  KEY idx_ai_conversation_runs_project (project_id, status, created_at),
  KEY idx_ai_conversation_runs_conversation (conversation_id, created_at),
  CONSTRAINT fk_ai_conversation_runs_conversation FOREIGN KEY (conversation_id)
    REFERENCES ai_conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_conversation_runs_project FOREIGN KEY (project_id)
    REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_conversation_runs_dispatcher FOREIGN KEY (dispatcher_user_id)
    REFERENCES users(id),
  CONSTRAINT fk_ai_conversation_runs_user_message FOREIGN KEY (user_message_id)
    REFERENCES ai_conversation_messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_conversation_runs_assistant_message FOREIGN KEY (assistant_message_id)
    REFERENCES ai_conversation_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_conversation_attachments (
  id                CHAR(36) NOT NULL,
  conversation_id   CHAR(36) NOT NULL,
  message_id        CHAR(36) NOT NULL,
  storage_key       VARCHAR(500) NOT NULL,
  original_name     VARCHAR(255) NOT NULL,
  mime_type         VARCHAR(120) NOT NULL,
  size_bytes        INT UNSIGNED NOT NULL,
  sha256            CHAR(64) NOT NULL,
  deleted_at        DATETIME(3) NULL,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_ai_conversation_attachments_message (message_id, deleted_at),
  CONSTRAINT fk_ai_conversation_attachments_conversation FOREIGN KEY (conversation_id)
    REFERENCES ai_conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_conversation_attachments_message FOREIGN KEY (message_id)
    REFERENCES ai_conversation_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_conversation_events (
  event_seq        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id CHAR(36) NOT NULL,
  event_type       VARCHAR(64) NOT NULL,
  entity_id        CHAR(36) NULL,
  payload_json     JSON NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (event_seq),
  KEY idx_ai_conversation_events_conversation (conversation_id, event_seq),
  CONSTRAINT fk_ai_conversation_events_conversation FOREIGN KEY (conversation_id)
    REFERENCES ai_conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_conversation_audit_events (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id CHAR(36) NOT NULL,
  project_id      CHAR(36) NULL,
  run_id          CHAR(36) NULL,
  message_id      CHAR(36) NULL,
  actor_kind      ENUM('user', 'dispatcher', 'system') NOT NULL,
  actor_user_id   CHAR(36) NULL,
  action          VARCHAR(80) NOT NULL,
  metadata_json   JSON NULL,
  request_id      VARCHAR(100) NULL,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_ai_conversation_audit_conversation (conversation_id, created_at),
  KEY idx_ai_conversation_audit_project (project_id, created_at),
  KEY idx_ai_conversation_audit_actor (actor_user_id, created_at),
  CONSTRAINT fk_ai_conversation_audit_conversation FOREIGN KEY (conversation_id)
    REFERENCES ai_conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_conversation_audit_actor FOREIGN KEY (actor_user_id)
    REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
