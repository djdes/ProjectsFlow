-- 004: task↔commit привязка. Snapshot-модель: message/author/date/url кешируются у нас,
-- чтобы render kanban-карточки не требовал GitHub API. Force-push → snapshot останется старый,
-- для operational notebook это приемлемо.

CREATE TABLE IF NOT EXISTS task_commits (
  task_id           CHAR(36)      NOT NULL,
  sha               VARCHAR(64)   NOT NULL,
  message           VARCHAR(2000) NOT NULL,
  author_name       VARCHAR(200)  NOT NULL,
  author_avatar_url VARCHAR(500)      NULL,
  html_url          VARCHAR(500)  NOT NULL,
  committed_at      TIMESTAMP     NOT NULL,
  linked_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id, sha),
  KEY idx_task_commits_sha (sha),
  KEY idx_task_commits_task_committed (task_id, committed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
