-- Тикеты поддержки из чат-виджета (вкладка «Связаться с поддержкой»).
-- Одна строка на отправленное обращение. user_id NULL — анонимная отправка (лендинг).
-- Доставка в Telegram-чат поддержки (SUPPORT_TELEGRAM_CHAT_ID) или fallback на
-- уведомление админам — best-effort на стороне приложения; тикет сохраняется всегда.
CREATE TABLE IF NOT EXISTS support_tickets (
  id         CHAR(36)              NOT NULL,
  user_id    CHAR(36)              NULL,
  message    TEXT                  NOT NULL,
  source     ENUM('app','landing') NOT NULL DEFAULT 'app',
  status     ENUM('open','closed') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP             NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_support_tickets_status_created (status, created_at),
  KEY idx_support_tickets_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
