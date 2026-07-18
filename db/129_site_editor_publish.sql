-- Preview/Edit draft publishing lifecycle. Kept separate from 128 because that
-- migration may already be installed on existing environments.
ALTER TABLE site_patches
  ADD COLUMN state ENUM('draft', 'queued') NOT NULL DEFAULT 'draft' AFTER created_by,
  ADD COLUMN publish_job_id CHAR(36) NULL AFTER state,
  ADD KEY idx_site_patches_publish_job (project_id, publish_job_id);
