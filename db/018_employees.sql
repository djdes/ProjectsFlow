-- db/018_employees.sql
-- Ростер сотрудников аккаунта-владельца для учёта трудозатрат по проектам.
-- Приватный: принадлежит owner_user_id, в проекты назначаются только свои сотрудники.
-- Деньги — целые копейки (BIGINT), чтобы не было float-ошибок.

CREATE TABLE IF NOT EXISTS employees (
  id                    CHAR(36)     NOT NULL,
  owner_user_id         CHAR(36)     NOT NULL,
  name                  VARCHAR(120) NOT NULL,
  monthly_salary_kopecks BIGINT      NOT NULL DEFAULT 0,
  active                BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_employees_owner (owner_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
