-- db/190_task_group_origin.sql
-- Задача, поставленная в рабочей Telegram-группе (например «Скрипты»), ложится в основное
-- пространство проекта, а на карточке видно, из какой группы она пришла.
--   origin_group_chat_id      — id Telegram-чата группы (NULL — задача не из группы);
--   origin_group_title        — название группы на момент постановки (снимок);
--   origin_group_author_user_id / origin_group_author_name — кто поставил (снимок имени).
-- Время постановки — tasks.created_at.

ALTER TABLE tasks
  ADD COLUMN origin_group_chat_id BIGINT NULL,
  ADD COLUMN origin_group_title VARCHAR(255) NULL,
  ADD COLUMN origin_group_author_user_id CHAR(36) NULL,
  ADD COLUMN origin_group_author_name VARCHAR(255) NULL;
