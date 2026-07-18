-- A Preview/Edit click may be retried by the browser or reverse proxy. Persist a
-- caller-generated key so retries return the original job instead of dispatching
-- the same AI edit twice. Existing rows receive stable, unique legacy keys first.
ALTER TABLE project_edit_jobs
  ADD COLUMN idempotency_key VARCHAR(100) NULL AFTER created_by;

UPDATE project_edit_jobs
SET idempotency_key = CONCAT('legacy:', id)
WHERE idempotency_key IS NULL;

ALTER TABLE project_edit_jobs
  MODIFY COLUMN idempotency_key VARCHAR(100) NOT NULL,
  ADD UNIQUE KEY uq_project_edit_jobs_idempotency (project_id, created_by, idempotency_key);
