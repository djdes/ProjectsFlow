-- db/032_task_awaiting_clarification.sql
-- Новый статус задачи: 'awaiting_clarification' («На уточнении») — активная работа на паузе
-- до действия человека (ответ на ralph-question, разбор после maxAttempts retry,
-- переформулировка задачи, auto-timeout F11). Сейчас диспетчер Ralph не может перевести
-- задачу в этот стейт — enum ругается 400. После миграции move → awaiting_clarification
-- работает; в UI появляется новая колонка между in_progress и done.
--
-- MariaDB: ALTER ENUM требует MODIFY COLUMN с полным новым списком. DEFAULT не меняем
-- (остаётся 'todo'), порядок остальных значений сохраняем — иначе строки бы перенумеровались.

ALTER TABLE tasks
  MODIFY COLUMN status ENUM('backlog','todo','in_progress','done','awaiting_clarification')
  NOT NULL DEFAULT 'todo';
