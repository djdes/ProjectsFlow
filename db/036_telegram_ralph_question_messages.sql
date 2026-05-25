-- db/036_telegram_ralph_question_messages.sql
-- Маппинг отправленных TG-сообщений с ralph-question на конкретный question_id —
-- чтобы при получении reply через webhook сматчить его обратно на вопрос и создать
-- <!-- ralph-answer --> комментарий в задаче. См. spec
-- C:/www/ralph/prompts/telegram-reply-to-ralph-answer.md.
--
-- Отдельная таблица (а не расширение telegram_outbound_messages) потому что:
--   * outbound — лог-only (append + cleanup), не запрашивается по message_id;
--   * здесь нужен primary key по (chat_id, message_id) для O(1) lookup в webhook handler;
--   * семантика разная — outbound пишет все send'ы (включая skipped), а нам нужны только
--     те где Telegram реально вернул message_id для ralph-question kinds.
--
-- TTL: записи живут долго (вопрос может быть открыт неделями); опциональная чистка
-- старше 30 дней — задача для DB-housekeep-cron'а в будущем.

CREATE TABLE telegram_ralph_question_messages (
  tg_chat_id BIGINT NOT NULL,
  tg_message_id BIGINT NOT NULL,
  recipient_user_id CHAR(36) NOT NULL,
  task_id CHAR(36) NOT NULL,
  ralph_question_id VARCHAR(64) NOT NULL,
  sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tg_chat_id, tg_message_id),
  KEY idx_tg_rq_task (task_id),
  KEY idx_tg_rq_user (recipient_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
