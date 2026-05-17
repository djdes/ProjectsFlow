-- 003: kanban tasks per project. Минимальная схема — title, описание, статус, порядок.
-- Position — float чтобы вставлять между без массового UPDATE (Lexorank-lite).

CREATE TABLE IF NOT EXISTS tasks (
  id              CHAR(36)                                   NOT NULL,
  project_id      CHAR(36)                                   NOT NULL,
  title           VARCHAR(200)                               NOT NULL,
  description     TEXT                                           NULL,
  status          ENUM('todo','in_progress','done')          NOT NULL DEFAULT 'todo',
  position        DOUBLE                                     NOT NULL DEFAULT 0,
  created_at      TIMESTAMP                                  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP                                  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tasks_project_status_position (project_id, status, position),
  KEY idx_tasks_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
