-- 134: soft delete for tasks (trash + undo).
-- Deleting a task no longer removes the row: it is marked with deleted_at, so restore
-- brings the SAME id back and every child row (comments, versions, commits, links)
-- survives the round-trip. Every task read path must add `deleted_at IS NULL`.
ALTER TABLE tasks
  ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL,
  ADD COLUMN deleted_by CHAR(36) NULL DEFAULT NULL;

-- Board/list reads are always scoped by project and always filter deleted_at IS NULL,
-- so the composite covers both the active board and the trash view of one project.
CREATE INDEX idx_tasks_project_deleted ON tasks (project_id, deleted_at);

-- "Assigned to me" spans projects and is the second hottest read path.
CREATE INDEX idx_tasks_assignee_deleted ON tasks (assignee_user_id, deleted_at);
