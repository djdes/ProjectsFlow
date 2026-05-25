-- db/033_telegram_link_and_outbound.sql
-- Multi-user Telegram уведомления через @projectsflow_bot.
-- Привязка TG-аккаунта к юзеру (Login Widget) + аудит исходящих сообщений (для дедупа и
-- отладки). Без token-таблиц — токен бота живёт в env. Спецификация: spec в
-- C:\www\ralph\prompts\multi-user-telegram-notifications.md.

ALTER TABLE users
  ADD COLUMN telegram_user_id BIGINT NULL,
  ADD COLUMN telegram_username VARCHAR(64) NULL,
  ADD COLUMN telegram_first_name VARCHAR(128) NULL,
  ADD COLUMN telegram_photo_url VARCHAR(512) NULL,
  ADD COLUMN telegram_auth_date TIMESTAMP NULL,
  -- tg_chat_id чаще всего равен telegram_user_id для личных чатов, но кэшируем явно
  -- после нажатия /start (Telegram не позволяет боту писать первым).
  ADD COLUMN tg_chat_id BIGINT NULL,
  ADD COLUMN tg_started_at TIMESTAMP NULL,
  ADD COLUMN tg_paired_at TIMESTAMP NULL,
  -- Префы хранятся как JSON (MariaDB-аналог JSONB). Дефолты — в коде через resolvePref-
  -- хелпер; неустановленные значения трактуются как «отправлять» для commentOnMyTask,
  -- mention, statusChange, ralphQuestion; и как «не отправлять» для ralphAnswer.
  ADD COLUMN tg_notification_prefs JSON NULL,
  ADD UNIQUE KEY uq_users_telegram_user_id (telegram_user_id);

CREATE TABLE telegram_outbound_messages (
  id            CHAR(36)     NOT NULL,
  user_id       CHAR(36)     NOT NULL,
  chat_id       BIGINT       NOT NULL,
  event_kind    VARCHAR(64)  NOT NULL,
  task_id       CHAR(36)     NULL,
  -- TG message_id из ответа sendMessage. NULL если sendMessage упал до возврата id.
  message_id    BIGINT       NULL,
  sent_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status        VARCHAR(32)  NOT NULL,
  error_text    VARCHAR(512) NULL,
  PRIMARY KEY (id),
  KEY idx_tg_out_user_sent (user_id, sent_at),
  KEY idx_tg_out_dedup (user_id, event_kind, task_id, sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
