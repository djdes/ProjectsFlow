-- 122_telegram_digest_actions.sql — привязка одноразового действия к Telegram-сводке.
-- После клика по кругу сервер завершает задачу и редактирует то же rich-сообщение:
-- круг закрашивается, название задачи зачёркивается.
CREATE TABLE IF NOT EXISTS telegram_digest_action_deliveries (
  token         VARCHAR(64)  NOT NULL,
  tg_chat_id    BIGINT       NOT NULL,
  tg_message_id BIGINT       NOT NULL,
  message_html  MEDIUMTEXT   NOT NULL,
  message_kind  ENUM('rich','html') NOT NULL DEFAULT 'rich',
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (token),
  KEY idx_tg_digest_action_message (tg_chat_id, tg_message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
