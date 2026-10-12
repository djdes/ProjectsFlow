-- Personal inboxes belong to exactly one owner in one workspace.
-- Existing tasks stay in their existing workspace; nothing is reassigned implicitly.
ALTER TABLE projects
  -- Keep foreign-key columns out of the generated expression (MariaDB 10.11).
  ADD COLUMN inbox_owner_marker TINYINT
    GENERATED ALWAYS AS (CASE WHEN is_inbox = 1 THEN 1 ELSE NULL END) VIRTUAL,
  ADD UNIQUE INDEX uq_workspace_inbox_owner (workspace_id, owner_id, inbox_owner_marker);

-- Persist the event's workspace, including after a task/project is moved or deleted.
ALTER TABLE notifications
  ADD COLUMN workspace_id CHAR(36) NULL,
  ADD INDEX idx_notifications_workspace_user_created (workspace_id, user_id, created_at);

UPDATE notifications n
LEFT JOIN tasks t ON t.id = JSON_UNQUOTE(JSON_EXTRACT(n.payload, '$.taskId'))
LEFT JOIN projects p ON p.id = COALESCE(
  JSON_UNQUOTE(JSON_EXTRACT(n.payload, '$.projectId')), t.project_id
)
SET n.workspace_id = COALESCE(
  JSON_UNQUOTE(JSON_EXTRACT(n.payload, '$.workspaceId')), p.workspace_id
);
