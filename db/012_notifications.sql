-- 012: in-app уведомления. Сейчас одна категория — mention в комментарии — но таблица
-- сделана общей под будущие типы (invite-accepted, task-assigned, comment-reply, ...).
-- Payload — JSON, schema'у держим в TS-domain'ах (NotificationPayload union по type).
--
-- См. spec docs/superpowers/specs/2026-05-19-multi-tenant-projects-design.md, секция «не делаем в этой spec'е».
-- Реализуется отдельно — но инфра в БД здесь.

CREATE TABLE IF NOT EXISTS notifications (
  id            CHAR(36)      NOT NULL,
  user_id       CHAR(36)      NOT NULL,
  type          VARCHAR(50)   NOT NULL,
  payload       JSON          NOT NULL,
  read_at       TIMESTAMP     NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notifications_user_created (user_id, created_at),
  KEY idx_notifications_user_unread (user_id, read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
