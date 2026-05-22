-- db/022_project_finance_visibility.sql
-- Видимость финансов проекта: по умолчанию только владелец/admin; 'members' — все участники.

ALTER TABLE projects
  ADD COLUMN finance_visibility ENUM('owner','members') NOT NULL DEFAULT 'owner';
