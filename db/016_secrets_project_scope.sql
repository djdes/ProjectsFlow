-- db/016_secrets_project_scope.sql
-- Multi-tenancy: секреты должны быть общими для всех участников проекта, а не
-- привязаны к юзеру-создателю. Раньше ключ был (user_id, secret_key) — другой
-- участник не мог разрезолвить vault-реф. Переводим scope на project_id.
--
-- user_id остаётся как audit (кто записал/обновил). Ключ доступа — (project_id, secret_key).
-- На момент миграции vault пуст, поэтому backfill не требуется; project_id оставляем
-- nullable для совместимости со старыми строками (если вдруг есть) — приложение всегда
-- проставляет его при записи.

ALTER TABLE secrets
  ADD COLUMN project_id CHAR(36) NULL AFTER user_id;

DROP INDEX uq_secrets_user_key ON secrets;

CREATE UNIQUE INDEX uq_secrets_project_key ON secrets (project_id, secret_key);
CREATE INDEX idx_secrets_project ON secrets (project_id);
