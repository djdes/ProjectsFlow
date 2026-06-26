-- Ответы и цитирование в комментариях задач.
--   reply_to_comment_id — id комментария, на который отвечают (и обычный ответ, и цитата).
--   quoted_text         — выделенный фрагмент исходного коммента (для цитаты); NULL у обычного ответа.
-- Обе nullable → обратная совместимость: исторические комменты = оба NULL.
ALTER TABLE task_comments
  ADD COLUMN reply_to_comment_id CHAR(36) NULL AFTER body,
  ADD COLUMN quoted_text TEXT NULL AFTER reply_to_comment_id;

CREATE INDEX idx_task_comments_reply_to ON task_comments (reply_to_comment_id);
