-- Правило «я ответственный ⇒ задача в моих личных»: личная задача всегда лежит во входящих
-- СВОЕГО ответственного. Раньше запись оставалась в инбоксе автора, и у ответственного она
-- появлялась чужой записью в собственных колонках («Личные · <чужое имя>» в своих
-- «Черновиках» читается как ошибка). Перенос владения при назначении делает
-- ChangeTaskAssignee; эта миграция приводит к правилу уже существующие строки.
--
-- Прежний владелец задачу не теряет: личные доски коллег видны во вкладке «Для всех»
-- (ListPersonalTasksOfColleagues).
--
-- Перед переносом снимаем backup «откуда уехала задача»: перемещение записей между
-- аккаунтами иначе необратимо (исходный project_id нигде не остаётся). Откат —
-- UPDATE tasks JOIN этой таблицы обратно по task_id.
CREATE TABLE IF NOT EXISTS task_inbox_transfer_backup_148 (
  task_id         CHAR(36)  NOT NULL,
  from_project_id CHAR(36)  NOT NULL,
  to_project_id   CHAR(36)  NOT NULL,
  moved_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO task_inbox_transfer_backup_148 (task_id, from_project_id, to_project_id)
SELECT t.id, holder.id, target.id
  FROM tasks t
  JOIN projects holder ON holder.id = t.project_id AND holder.is_inbox = 1
  JOIN projects target
    ON target.owner_id = t.assignee_user_id
   AND target.is_inbox = 1
   AND target.id <> holder.id
 WHERE t.deleted_at IS NULL
   AND t.assignee_user_id <> holder.owner_id;

-- Переносим только живые задачи (deleted_at IS NULL, db/134): корзину ворошить незачем.
-- Задачи именованных проектов не трогаем — они живут на доске своего проекта.
-- Если у ответственного ещё нет инбокса, JOIN не найдёт цель и строка останется на месте.
-- Guard `target.id <> holder.id` => повторный прогон безопасен (no-op).
UPDATE tasks t
  JOIN projects holder ON holder.id = t.project_id AND holder.is_inbox = 1
  JOIN projects target
    ON target.owner_id = t.assignee_user_id
   AND target.is_inbox = 1
   AND target.id <> holder.id
  SET t.project_id = target.id
  WHERE t.deleted_at IS NULL
    AND t.assignee_user_id <> holder.owner_id;
