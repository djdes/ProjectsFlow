-- Дата начала работ (Notion date range: start → deadline). DATE без времени,
-- как deadline (db/041). NULL = событие одного дня (только deadline).
ALTER TABLE tasks
  ADD COLUMN start_date DATE NULL AFTER deadline;
