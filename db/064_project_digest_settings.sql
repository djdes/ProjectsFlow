-- Настройки дайджеста проекта:
--  1) Telegram-группа проекта — для ручного экспорта «в группу» и канала «в группу»
--     ежедневной сводки (chat_id, который бот ProjectsFlow_Bot получил в группе).
--  2) Ежедневная автоматическая сводка по задачам: время (МSK), получатели, каналы,
--     цель Telegram (личка/группа), какие колонки включать.
-- Одна строка на проект (lazy-upsert). См. spec kanban-multiselect-bulk-actions + фидбэк.
CREATE TABLE IF NOT EXISTS project_digest_settings (
  project_id              CHAR(36)     NOT NULL,
  -- Telegram-группа. chat_id у групп/супергрупп отрицательный (супергруппа: -100…).
  telegram_group_chat_id  BIGINT       NULL,
  telegram_group_title    VARCHAR(255) NULL,
  -- Ежедневная сводка.
  daily_enabled           BOOLEAN      NOT NULL DEFAULT FALSE,
  daily_hour              TINYINT      NOT NULL DEFAULT 9,   -- 0..23 (Europe/Moscow)
  daily_minute            TINYINT      NOT NULL DEFAULT 0,   -- 0..59
  daily_recipients        JSON         NULL,  -- ["userId", ...] — участники проекта
  daily_channels          JSON         NULL,  -- ["email","telegram","notification"]
  daily_tg_targets        JSON         NULL,  -- ["personal","group"]
  daily_statuses          JSON         NULL,  -- ["backlog","manual","todo","done"]
  daily_last_sent_on      DATE         NULL,  -- МSK-дата последней отправки (анти-дубль)
  updated_at              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id),
  CONSTRAINT fk_pds_project FOREIGN KEY (project_id)
    REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
