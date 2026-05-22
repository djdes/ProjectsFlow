-- db/020_project_expenses.sql
-- Прочие расходы проекта (реклама, инфраструктура, инструменты и т.д.) — суммы в копейках.

CREATE TABLE IF NOT EXISTS project_expenses (
  id             CHAR(36)     NOT NULL,
  project_id     CHAR(36)     NOT NULL,
  amount_kopecks BIGINT       NOT NULL,
  category       VARCHAR(40)  NOT NULL DEFAULT 'other',
  description    VARCHAR(500) NULL,
  incurred_on    DATE         NOT NULL,
  created_by     CHAR(36)     NOT NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_expenses_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
