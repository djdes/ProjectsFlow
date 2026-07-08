-- Привязка группового TG-чата к аккаунту-владельцу. Нужна для гибрид-маршрутизации задач из
-- групп: сообщение от участника, который НЕ действует «как отправитель» (не привязан или без
-- своего +Проекта), падает в «Входящие» этого владельца (см. spec
-- 2026-07-08-telegram-group-multi-user-tasks-design). Владелец назначается first-writer-wins:
-- первый привязанный пользователь, отправивший /start в группе.
CREATE TABLE telegram_group_owners (
  tg_chat_id     BIGINT      NOT NULL,             -- id группового чата (group/supergroup)
  owner_user_id  CHAR(36)    NOT NULL,             -- аккаунт-владелец: сюда падают fallback-задачи
  created_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tg_chat_id),
  KEY idx_tgo_owner (owner_user_id),
  CONSTRAINT fk_tgo_owner_user FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
