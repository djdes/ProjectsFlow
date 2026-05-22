-- db/026_project_kb_kind.sql
-- Тип Базы знаний проекта: none / github / local (KB без git-репозитория).
-- Backfill: проекты с привязанным KB-репо → 'github'.

ALTER TABLE projects
  ADD COLUMN kb_kind ENUM('none','github','local') NOT NULL DEFAULT 'none';

UPDATE projects SET kb_kind = 'github' WHERE kb_repo_full_name IS NOT NULL;
