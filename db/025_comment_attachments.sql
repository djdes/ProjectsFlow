-- db/025_comment_attachments.sql
-- Вложения в комментариях. Переиспользуем таблицу task_attachments: nullable comment_id.
-- NULL = вложение самой задачи (как раньше); заполнен = вложение конкретного комментария.
-- task_id остаётся заполнен всегда (комментарий принадлежит задаче) — авторизация отдачи
-- бинаря идёт через task→project и не меняется.

ALTER TABLE task_attachments
  ADD COLUMN comment_id CHAR(36) NULL,
  ADD KEY idx_task_attachments_comment (comment_id);
