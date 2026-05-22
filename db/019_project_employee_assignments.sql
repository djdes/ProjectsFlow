-- db/019_project_employee_assignments.sql
-- Кто из сотрудников работает над проектом и с какой долей занятости.
-- allocation_percent (1..100) делит оклад между проектами; started_at/ended_at задают
-- период работы (для помесячной пропорции). UNIQUE(project, employee) — без дублей.

CREATE TABLE IF NOT EXISTS project_employee_assignments (
  id                 CHAR(36)  NOT NULL,
  project_id         CHAR(36)  NOT NULL,
  employee_id        CHAR(36)  NOT NULL,
  allocation_percent SMALLINT  NOT NULL DEFAULT 100,
  started_at         DATE      NOT NULL,
  ended_at           DATE      NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_assignment_project_employee (project_id, employee_id),
  KEY idx_assignment_project (project_id),
  KEY idx_assignment_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
