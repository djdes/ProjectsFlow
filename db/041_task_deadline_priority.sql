-- 041: deadline + priority на tasks. Опциональные поля (NULL = не задано).
-- deadline: DATE без времени (UI использует <input type="date">). Если позже
-- захотим время — добавим отдельной миграцией task_deadline_time или сменим
-- тип на DATETIME.
-- priority: TINYINT 1..4 в стиле Todoist (1=urgent, 4=low). NULL = без приоритета.

ALTER TABLE tasks
  ADD COLUMN deadline DATE NULL,
  ADD COLUMN priority TINYINT UNSIGNED NULL;
