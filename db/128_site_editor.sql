-- Persisted, project-scoped Preview Editor state. Tokens are stored only as SHA-256
-- hashes; patch mutations use a monotonically increasing patch-set revision.
CREATE TABLE site_editor_sessions (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  route VARCHAR(500) NOT NULL DEFAULT '/',
  artifact_version VARCHAR(128) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_site_editor_sessions_token_hash (token_hash),
  KEY idx_site_editor_sessions_project (project_id, expires_at, revoked_at)
);

CREATE TABLE site_patch_sets (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  route VARCHAR(500) NOT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_site_patch_sets_project_route (project_id, route),
  KEY idx_site_patch_sets_project (project_id, updated_at)
);

CREATE TABLE site_patches (
  id CHAR(36) PRIMARY KEY,
  patch_set_id CHAR(36) NOT NULL,
  project_id CHAR(36) NOT NULL,
  locator_json MEDIUMTEXT NOT NULL,
  kind ENUM('text', 'style', 'attribute', 'visibility', 'command') NOT NULL,
  payload_json MEDIUMTEXT NOT NULL,
  idempotency_key VARCHAR(100) NOT NULL,
  created_revision INT UNSIGNED NOT NULL,
  created_by CHAR(36) NOT NULL,
  deleted_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_site_patches_idempotency (patch_set_id, idempotency_key),
  KEY idx_site_patches_project_set (project_id, patch_set_id, deleted_at, created_revision)
);

CREATE TABLE project_edit_jobs (
  id CHAR(36) PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  created_by CHAR(36) NOT NULL,
  dispatcher_user_id CHAR(36) NOT NULL,
  status ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
  operation ENUM('rewrite_text', 'restyle', 'regenerate_element', 'regenerate_section', 'replace_icon', 'edit_code') NOT NULL,
  route VARCHAR(500) NOT NULL,
  locator_json MEDIUMTEXT NOT NULL,
  dom_snapshot MEDIUMTEXT NOT NULL,
  computed_styles_json MEDIUMTEXT NOT NULL,
  prompt TEXT NOT NULL,
  artifact_version VARCHAR(128) NOT NULL,
  result_json MEDIUMTEXT NULL,
  error VARCHAR(500) NULL,
  claimed_at TIMESTAMP NULL,
  finished_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_project_edit_jobs_dispatcher (dispatcher_user_id, status, created_at),
  KEY idx_project_edit_jobs_project (project_id, status, created_at)
);
