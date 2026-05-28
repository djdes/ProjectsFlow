-- 039: делегирование inbox-задач. One-to-one: одна активная (pending|accepted)
-- делегация на задачу. Архивные/declined/withdrawn остаются как история (no DELETE).
-- См. spec docs/superpowers/specs/2026-05-27-inbox-checkbox-and-delegation-design.md.

CREATE TABLE IF NOT EXISTS task_delegations (
  id               CHAR(36)    NOT NULL,
  task_id          CHAR(36)    NOT NULL,
  delegate_user_id CHAR(36)    NOT NULL,
  status           ENUM('pending','accepted','declined','withdrawn','archived')
                   NOT NULL DEFAULT 'pending',
  created_at       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at     TIMESTAMP   NULL,
  PRIMARY KEY (id),
  KEY idx_task_status (task_id, status),
  KEY idx_delegate_status (delegate_user_id, status),
  CONSTRAINT fk_td_task FOREIGN KEY (task_id)
    REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_td_user FOREIGN KEY (delegate_user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
