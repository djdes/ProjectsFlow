-- db/189_telegram_group_projects.sql
-- Telegram-группы черновиком и проекты группы (spec 2026-11-17
-- «telegram-group-projects-and-worker-orchestrator», §1–§2, шаг 3).
--   status: draft — бот сам добавил группу, ждёт подтверждения владельца/руководителя
--           пространства (ничего не открывает); active — рабочая группа (все прежние группы);
--           disconnected — бота удалили из группы.
--   mode: задел для шага 4 (incident), пока без поведения.
--   invited_by_tg_user_id — кто добавил бота в группу (Telegram id).
--   transfer_* — запрос другого пространства забрать отключённую группу; группа переезжает
--           только после одобрения владельцем текущего пространства.

ALTER TABLE workspace_telegram_groups
  ADD COLUMN status ENUM('draft','active','disconnected') NOT NULL DEFAULT 'active',
  ADD COLUMN mode ENUM('standard','incident') NOT NULL DEFAULT 'standard',
  ADD COLUMN invited_by_tg_user_id BIGINT NULL,
  ADD COLUMN transfer_to_workspace_id CHAR(36) NULL,
  ADD COLUMN transfer_requested_by_user_id CHAR(36) NULL,
  ADD COLUMN transfer_target_status ENUM('draft','active') NULL,
  ADD COLUMN transfer_requested_at TIMESTAMP NULL;

-- Проекты, доступные группе. Пусто — все проекты пространства (как до этой фичи).
-- ON UPDATE CASCADE — группа переезжает на новый id при миграции в супергруппу.
CREATE TABLE IF NOT EXISTS telegram_group_projects (
  tg_chat_id       BIGINT    NOT NULL,
  project_id       CHAR(36)  NOT NULL,
  added_by_user_id CHAR(36)  NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tg_chat_id, project_id),
  KEY idx_tgp_project (project_id),
  CONSTRAINT fk_tgp_group FOREIGN KEY (tg_chat_id)
    REFERENCES workspace_telegram_groups (tg_chat_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_tgp_project FOREIGN KEY (project_id)
    REFERENCES projects (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
