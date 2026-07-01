-- Кто создал задачу («кто отдал воркеру») — для пер-юзерной атрибуции расхода диспетчера.
-- Раньше создатель задачи нигде не хранился (только делегатор в task_delegations, и то лишь
-- для явно делегированных задач). Обычная todo-задача не имела «инициатора» → расход воркера
-- уходил в fallback на диспетчера. Теперь created_by заполняется при создании (CreateTask).
-- Backfill: для старых задач берём делегатора из активной делегации, если он есть.
ALTER TABLE tasks
  ADD COLUMN created_by CHAR(36) NULL AFTER project_id;

UPDATE tasks t
  JOIN task_delegations d ON d.task_id = t.id AND d.delegator_user_id IS NOT NULL
  SET t.created_by = d.delegator_user_id
  WHERE t.created_by IS NULL;
