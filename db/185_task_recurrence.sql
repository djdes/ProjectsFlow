-- 185: повторяющиеся задачи (Todoist-style «every»).
--
-- recurrence — правило повтора компактной строкой: 'daily' | 'weekdays' | 'weekly:1,3,5'
-- (дни недели по ISO, 1 = пн … 7 = вс) | 'monthly:31' (число месяца; в коротком месяце —
-- его последний день). NULL = задача не повторяется. VARCHAR, а не ENUM/JSON: разбор и
-- валидация — в домене (domain/task/TaskRecurrence), строка остаётся читаемой в выборках.
--
-- recurrence_next_task_id — следующий повтор, уже поставленный при выполнении этой задачи.
-- Гарантирует идемпотентность: «выполнить → вернуть в работу → выполнить» не плодит вторую
-- копию. Заполняется атомарным UPDATE ... WHERE recurrence_next_task_id IS NULL до создания
-- копии (сначала резерв, потом id созданной задачи). Ссылка мягкая, без FK: копию можно
-- удалить, а пометку у выполненной задачи — нет.
ALTER TABLE tasks
  ADD COLUMN recurrence VARCHAR(64) NULL DEFAULT NULL,
  ADD COLUMN recurrence_next_task_id CHAR(36) NULL DEFAULT NULL;
