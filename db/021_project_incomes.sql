-- db/021_project_incomes.sql
-- Доходы проекта (пока вносятся вручную; в будущем — автоимпорт из банка/платёжки).

CREATE TABLE IF NOT EXISTS project_incomes (
  id             CHAR(36)     NOT NULL,
  project_id     CHAR(36)     NOT NULL,
  amount_kopecks BIGINT       NOT NULL,
  source         VARCHAR(120) NULL,
  received_on    DATE         NOT NULL,
  created_by     CHAR(36)     NOT NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_incomes_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
