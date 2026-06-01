-- Маппинг отправленных ботом сообщений, привязанных к задаче (карточка-подтверждение
-- конструктора, сообщение делегирования, карточка из /tasks) → task_id. Обобщает
-- telegram_ralph_question_messages (db/036): позволяет ответить reply'ем на ЛЮБОЕ
-- task-сообщение бота и создать обычный комментарий. PK по (chat_id, message_id) —
-- message_id уникален только внутри чата.
CREATE TABLE telegram_task_messages (
  tg_chat_id        BIGINT     NOT NULL,
  tg_message_id     BIGINT     NOT NULL,
  recipient_user_id CHAR(36)   NOT NULL,
  task_id           CHAR(36)   NOT NULL,
  project_id        CHAR(36)   NOT NULL,
  sent_at           TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tg_chat_id, tg_message_id),
  KEY idx_ttm_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
