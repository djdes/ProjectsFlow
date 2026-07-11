-- Подзадачи (Notion sub-items): ссылка на родительскую задачу того же проекта.
-- Без FK (паттерн репо) — при удалении родителя дети отвязываются приложением.
ALTER TABLE tasks
  ADD COLUMN parent_task_id CHAR(36) NULL AFTER position,
  ADD INDEX idx_tasks_parent (parent_task_id);
