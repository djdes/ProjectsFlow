-- 113: единый обязательный ответственный задачи.
--
-- Раньше ответственный выводился из активной task_delegations-строки, а отсутствие
-- делегации неявно означало владельца/создателя. Это давало две разные модели одной
-- сущности и не позволяло безопасно «забрать задачу себе». Теперь источник истины один:
-- tasks.assignee_user_id. Исторические task_delegations сохраняем как аудит, но новая
-- логика их не читает и не создаёт.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS assignee_user_id CHAR(36) NULL AFTER created_by;

-- Во время deploy старый PM2-процесс продолжает работать до конца migrate. Триггеры
-- закрывают короткое окно совместимости: старый код ещё не передаёт assignee_user_id и
-- может создать accepted delegation после основного backfill.
DROP TRIGGER IF EXISTS trg_tasks_default_assignee;
CREATE TRIGGER trg_tasks_default_assignee
BEFORE INSERT ON tasks
FOR EACH ROW
SET NEW.assignee_user_id = COALESCE(
  NEW.assignee_user_id,
  NEW.created_by,
  (SELECT p.owner_id FROM projects p WHERE p.id = NEW.project_id LIMIT 1)
);

DROP TRIGGER IF EXISTS trg_task_delegation_sync_assignee;
CREATE TRIGGER trg_task_delegation_sync_assignee
AFTER INSERT ON task_delegations
FOR EACH ROW
UPDATE tasks
   SET assignee_user_id = NEW.delegate_user_id
 WHERE id = NEW.task_id
   AND NEW.status = 'accepted';

-- Старый процесс создавал строку pending, а принятие оформлял отдельным UPDATE.
-- Этот триггер закрывает тот же rolling-deploy сценарий для уже созданных строк.
DROP TRIGGER IF EXISTS trg_task_delegation_update_sync_assignee;
CREATE TRIGGER trg_task_delegation_update_sync_assignee
AFTER UPDATE ON task_delegations
FOR EACH ROW
UPDATE tasks
   SET assignee_user_id = NEW.delegate_user_id
 WHERE id = NEW.task_id
   AND NEW.status = 'accepted';

-- Для уже делегированной задачи выигрывает последний active-исполнитель. Для остальных
-- берём фактического создателя; у совсем старых строк created_by=NULL — владельца проекта.
UPDATE tasks t
  JOIN projects p ON p.id = t.project_id
   SET t.assignee_user_id = COALESCE(
         (
           SELECT td.delegate_user_id
             FROM task_delegations td
            WHERE td.task_id = t.id
              AND td.status = 'accepted'
            ORDER BY COALESCE(td.responded_at, td.created_at) DESC,
                     td.created_at DESC,
                     td.id DESC
            LIMIT 1
         ),
         t.created_by,
         p.owner_id
       )
 WHERE t.assignee_user_id IS NULL;

ALTER TABLE tasks
  MODIFY COLUMN assignee_user_id CHAR(36) NOT NULL;

ALTER TABLE tasks
  ADD INDEX IF NOT EXISTS idx_tasks_assignee (assignee_user_id);
