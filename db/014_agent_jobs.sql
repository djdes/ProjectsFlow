-- db/014_agent_jobs.sql
-- Очередь и история agent-job'ов для kanban-agent runner'а.
-- См. docs/superpowers/specs/2026-05-21-kanban-agent-runner-design.md

CREATE TABLE agent_jobs (
  id            CHAR(36)     NOT NULL,
  project_id    CHAR(36)     NOT NULL,
  task_id       CHAR(36)     NOT NULL,
  status        ENUM('queued','running','succeeded','failed','cancelled') NOT NULL DEFAULT 'queued',
  attempt       INT          NOT NULL DEFAULT 1,
  claimed_at    TIMESTAMP    NULL,
  started_at    TIMESTAMP    NULL,
  finished_at   TIMESTAMP    NULL,
  error         TEXT         NULL,
  pr_url        VARCHAR(500) NULL,
  branch_name   VARCHAR(200) NULL,
  runner_pid    INT          NULL,
  created_by    CHAR(36)     NOT NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agent_jobs_status (status),
  KEY idx_agent_jobs_project_status (project_id, status),
  KEY idx_agent_jobs_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
