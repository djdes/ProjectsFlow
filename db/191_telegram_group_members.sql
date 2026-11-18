-- Участники рабочих Telegram-групп (spec 2026-11-17 «telegram-group-projects-and-worker-
-- orchestrator», §4, шаг 5). Полного списка участников бот получить не может: знаем
-- администраторов (снимок getChatAdministrators при подключении группы), события chat_member
-- (приходят, только если бот — администратор группы), вступления и авторов сообщений.
--   status: member | admin | left — вышедший остаётся строкой left (из пространства не удаляем);
--   source: откуда узнали в последний раз — admins (снимок) | join (chat_member / вступление) |
--           message (автор сообщения);
--   seen_at: когда видели последний раз.
-- ON UPDATE CASCADE — группа переезжает на новый id при миграции в супергруппу; удаление
-- рабочей группы удаляет и её участников.

CREATE TABLE IF NOT EXISTS telegram_group_members (
  tg_chat_id  BIGINT    NOT NULL,
  tg_user_id  BIGINT    NOT NULL,
  status      ENUM('member','admin','left') NOT NULL,
  source      ENUM('admins','join','message') NOT NULL,
  seen_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tg_chat_id, tg_user_id),
  KEY idx_tgm_user (tg_user_id),
  CONSTRAINT fk_tgm_group FOREIGN KEY (tg_chat_id)
    REFERENCES workspace_telegram_groups (tg_chat_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
