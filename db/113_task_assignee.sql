-- 113: единый обязательный ответственный задачи.
--
-- Раньше ответственный выводился из активной task_delegations-строки, а отсутствие
-- делегации неявно означало владельца/создателя. Это давало две разные модели одной
-- сущности и не позволяло безопасно «забрать задачу себе». Теперь источник истины один:
-- tasks.assignee_user_id. Исторические task_delegations сохраняем как аудит, но новая
-- логика их не читает и не создаёт.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS assignee_user_id CHAR(36) NULL AFTER created_by;

-- Для уже делегированной задачи выигрывает последний active-исполнитель. Для остальных
-- берём фактического создателя; у совсем старых строк created_by=NULL — владельца проекта.
-- WRITE-lock не даёт старому PM2-процессу вставить NULL между backfill и NOT NULL.
-- В отличие от триггеров он не требует SUPER при включённом binary log в MariaDB.
LOCK TABLES
  tasks WRITE,
  projects READ,
  task_delegations READ;

UPDATE tasks
  JOIN projects ON projects.id = tasks.project_id
   SET tasks.assignee_user_id = COALESCE(
         (
           SELECT task_delegations.delegate_user_id
             FROM task_delegations
            WHERE task_delegations.task_id = tasks.id
              AND task_delegations.status = 'accepted'
            ORDER BY COALESCE(task_delegations.responded_at, task_delegations.created_at) DESC,
                     task_delegations.created_at DESC,
                     task_delegations.id DESC
            LIMIT 1
         ),
         tasks.created_by,
         projects.owner_id
       )
 WHERE tasks.assignee_user_id IS NULL;

ALTER TABLE tasks
  MODIFY COLUMN assignee_user_id CHAR(36) NOT NULL,
  ADD INDEX IF NOT EXISTS idx_tasks_assignee (assignee_user_id),
  LOCK = EXCLUSIVE;

UNLOCK TABLES;
