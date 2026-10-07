-- Workspace membership grants access by default; these rows are explicit exceptions.
CREATE TABLE IF NOT EXISTS workspace_project_exclusions (
  workspace_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, project_id, user_id),
  KEY idx_wpe_member (workspace_id, user_id),
  KEY idx_wpe_project (project_id),
  CONSTRAINT fk_wpe_member FOREIGN KEY (workspace_id, user_id)
    REFERENCES workspace_members (workspace_id, user_id) ON DELETE CASCADE,
  CONSTRAINT fk_wpe_project FOREIGN KEY (project_id)
    REFERENCES projects (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE workspace_invites ADD COLUMN IF NOT EXISTS excluded_project_ids JSON NULL;
