-- Серверный стейт многошагового конструктора задач в Telegram-боте (+проект текст @делегат).
-- callback_data в кнопках ограничен 64 байтами, поэтому в кнопках носим только короткий
-- draft_id (CHAR(12)) + индексы; полный контекст (текст, выбранный проект, делегат,
-- предложенные варианты для index→UUID) лежит здесь. TTL ~30 минут (expires_at).
-- Чистится лениво (getById возвращает NULL если expires_at < now) + фоновым deleteExpired.
CREATE TABLE telegram_task_drafts (
  id               CHAR(12)    NOT NULL,           -- короткий токен (base64url 9 байт), влезает в callback_data
  creator_user_id  CHAR(36)    NOT NULL,
  tg_chat_id       BIGINT      NOT NULL,
  task_text        TEXT        NULL,
  project_id       CHAR(36)    NULL,               -- выбранный проект (NULL = «Входящие»)
  delegate_user_id CHAR(36)    NULL,               -- выбранный делегат (NULL = без делегирования)
  delegation_id    CHAR(36)    NULL,               -- проставляется после createTask с делегацией (фаза B)
  offered          JSON        NULL,               -- предложенные projects/members для index→UUID мэппинга
  status           ENUM('composing','confirmed','cancelled','expired') NOT NULL DEFAULT 'composing',
  created_at       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at       TIMESTAMP   NOT NULL,
  PRIMARY KEY (id),
  KEY idx_ttd_creator (creator_user_id),
  KEY idx_ttd_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
