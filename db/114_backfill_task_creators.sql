-- До db/088 обычные задачи не сохраняли автора: восстановить его из владельца проекта.
-- Явно делегированные старые задачи уже получили delegator_user_id в db/088, поэтому
-- здесь заполняются только оставшиеся NULL. Новые задачи всегда пишут реального actor-а.
UPDATE tasks
  JOIN projects ON projects.id = tasks.project_id
   SET tasks.created_by = projects.owner_id
 WHERE tasks.created_by IS NULL;

-- После полного backfill каждая задача обязана иметь отдельного создателя независимо
-- от текущего ответственного.
ALTER TABLE tasks
  MODIFY COLUMN created_by CHAR(36) NOT NULL;
