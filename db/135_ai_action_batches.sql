-- 135: server-side journal of AI action batches (plan -> apply/reject -> undo).
-- Until now the plan was executed purely on the client: idempotency lived in
-- localStorage and the undo journal lived in a React ref, so a reload silently lost
-- the ability to roll back and a re-render could replay the same plan twice.
-- The batch row is the idempotency gate (UNIQUE conversation_id + idempotency_key,
-- the key being the assistant message id) and the items carry before_json snapshots
-- that make undo survive F5.

CREATE TABLE IF NOT EXISTS ai_action_batches (
  id               CHAR(36) NOT NULL,
  conversation_id  CHAR(36) NOT NULL,
  -- Assistant message that carried the plan. NULL only for plans rendered before the
  -- message got its durable id; the idempotency key then falls back to a plan fingerprint.
  message_id       CHAR(36) NULL,
  owner_user_id    CHAR(36) NOT NULL,
  project_id       CHAR(36) NULL,
  status           ENUM('pending_review', 'applied', 'rejected', 'undone')
                   NOT NULL DEFAULT 'pending_review',
  title            VARCHAR(200) NOT NULL,
  plan_json        JSON NULL,
  idempotency_key  VARCHAR(100) NOT NULL,
  created_by       CHAR(36) NOT NULL,
  applied_at       DATETIME(3) NULL,
  undone_at        DATETIME(3) NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                   ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ai_action_batches_idempotency (conversation_id, idempotency_key),
  KEY idx_ai_action_batches_conversation (conversation_id, created_at),
  KEY idx_ai_action_batches_owner (owner_user_id, created_at),
  CONSTRAINT fk_ai_action_batches_conversation FOREIGN KEY (conversation_id)
    REFERENCES ai_conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_action_batches_owner FOREIGN KEY (owner_user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_action_batch_items (
  id             CHAR(36) NOT NULL,
  batch_id       CHAR(36) NOT NULL,
  -- Execution order inside the batch. Undo walks it in reverse: create_project must be
  -- removed after the create_task rows that reference it.
  position       INT UNSIGNED NOT NULL,
  -- Action id from the plan. NOT unique per batch on purpose: delete_all_tasks expands
  -- into one item per affected task, all sharing the same action id.
  action_id      VARCHAR(80) NOT NULL,
  type           VARCHAR(40) NOT NULL,
  entity_kind    ENUM('project', 'task') NOT NULL,
  -- NULL until the client reports what the action actually created/touched.
  entity_id      CHAR(36) NULL,
  project_id     CHAR(36) NULL,
  title          VARCHAR(300) NOT NULL,
  status         ENUM('pending', 'done', 'failed', 'undone') NOT NULL DEFAULT 'pending',
  -- Snapshot of the mutated fields BEFORE the action ran. The only source of truth for
  -- rolling back update_task after the tab that produced it is gone.
  before_json    JSON NULL,
  error_message  VARCHAR(500) NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                 ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_ai_action_batch_items_batch (batch_id, position),
  CONSTRAINT fk_ai_action_batch_items_batch FOREIGN KEY (batch_id)
    REFERENCES ai_action_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
