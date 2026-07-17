-- Short-lived worker capabilities. The long-lived account token stays in the
-- dispatcher; a Claude worker receives only a child token bound to one project
-- (and, for normal task runs, one task).
ALTER TABLE agent_tokens
  ADD COLUMN scope_kind ENUM('account', 'project') NOT NULL DEFAULT 'account' AFTER token_prefix,
  ADD COLUMN project_id CHAR(36) NULL AFTER scope_kind,
  ADD COLUMN task_id CHAR(36) NULL AFTER project_id,
  ADD COLUMN parent_token_id CHAR(36) NULL AFTER task_id,
  ADD COLUMN expires_at TIMESTAMP NULL AFTER parent_token_id;

CREATE INDEX idx_agent_tokens_scope
  ON agent_tokens (scope_kind, project_id, expires_at);

CREATE INDEX idx_agent_tokens_parent
  ON agent_tokens (parent_token_id);
