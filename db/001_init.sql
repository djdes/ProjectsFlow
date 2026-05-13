-- ProjectsFlow — initial schema
-- charset utf8mb4 для корректной работы с кириллицей и эмодзи.

CREATE TABLE IF NOT EXISTS projects (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug        VARCHAR(160)  NOT NULL,
  title       VARCHAR(255)  NOT NULL,
  year        SMALLINT      NOT NULL,
  period      VARCHAR(64)   NOT NULL DEFAULT '',
  category    VARCHAR(64)   NOT NULL DEFAULT '',
  summary     VARCHAR(500)  NOT NULL DEFAULT '',
  body        TEXT          NOT NULL,
  tags        VARCHAR(255)  NOT NULL DEFAULT '',
  outcome     VARCHAR(255)      NULL,
  client      VARCHAR(160)      NULL,
  status      ENUM('live','archived','in-progress','hidden') NOT NULL DEFAULT 'archived',
  sort_order  SMALLINT      NOT NULL DEFAULT 0,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_projects_slug (slug),
  KEY idx_projects_year (year),
  KEY idx_projects_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
