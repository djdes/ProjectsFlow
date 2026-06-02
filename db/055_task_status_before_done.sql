-- 055: статус задачи до перехода в 'done'. Нужен, чтобы снятие галочки «выполнено»
-- восстанавливало реальную прежнюю колонку, а не всегда 'todo'. См. план «Поручено мне».
--
-- VARCHAR(24), не ENUM — forward-compat: при расширении enum статусов не нужен MODIFY
-- (зеркалит подход ralph_mode VARCHAR). 24 >= len('awaiting_clarification')=22.
-- Nullable, без бэкфилла: существующие/legacy-done строки => NULL => фолбэк 'todo'.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS status_before_done VARCHAR(24) NULL AFTER status;
