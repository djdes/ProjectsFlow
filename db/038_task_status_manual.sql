-- db/038_task_status_manual.sql
-- Новый статус задачи: 'manual' («В РУЧНУЮ») — колонка для задач, которые делает
-- человек руками. Отдельная ветка вне agent-pipeline'а: не триггерит auto-transition
-- todo→in_progress, не попадает в очередь диспетчера агента, не показывается с
-- янтарным «дыханием». Перевод сюда — только явный action юзера (drag или `+` на колонке).
--
-- Append-only (как db/032): 'manual' идёт в конец списка, чтобы существующие
-- строки сохранили numeric storage order MariaDB ENUM'а.

ALTER TABLE tasks
  MODIFY COLUMN status ENUM('backlog','todo','in_progress','done','awaiting_clarification','manual')
  NOT NULL DEFAULT 'todo';
