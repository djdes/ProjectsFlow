-- db/037_task_ralph_cancel.sql
-- Кнопка «🛑 Отменить выполнение Ralph» — pull-based отмена работающего worker'а.
-- Юзер ставит флаг через POST /ralph-cancel; Ralph дисдетчер каждые ~5с поллит
-- активные задачи через GET /api/agent/.../tasks, видит флаг → убивает worker'а →
-- ack'ает через POST /ralph-cancel-ack (сброс обоих полей). См. spec
-- C:/www/ralph/prompts/task-ralph-cancel.md.
--
-- ralph_cancel_requested_at — момент запроса (NULL = не запрошено).
-- ralph_cancel_requested_by — кто запросил (FK на users, NULL если запроса нет).
-- Индекс — для частичного быстрого поиска «есть ли активные cancel'ы» при поллинге
-- Ralph'ом (MariaDB не поддерживает WHERE-индексы как Postgres, поэтому делаем
-- обычный B-tree; queries по this column обычно будут с явным IS NOT NULL).

ALTER TABLE tasks
  ADD COLUMN ralph_cancel_requested_at TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN ralph_cancel_requested_by CHAR(36) NULL DEFAULT NULL,
  ADD INDEX idx_tasks_ralph_cancel (ralph_cancel_requested_at);
