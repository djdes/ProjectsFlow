-- 078: лента действий (activity feed) — амбиентная активность по проектам для вкладки
-- «Все» в панели общения. Одна строка на СОБЫТИЕ (не на получателя); скоуп при чтении
-- по project_members + активному пространству. Хранение 30 дней (GC).
-- См. docs/superpowers/specs (workspace activity feed).

CREATE TABLE IF NOT EXISTS activity_events (
  id            CHAR(36)    NOT NULL,
  -- денормализованный workspace для быстрой workspace-scoped выборки. Если проект
  -- переедет в другое пространство — старые события сохраняют прежний workspace_id
  -- (лента эфемерна, 30 дней — допустимо).
  workspace_id  CHAR(36)    NOT NULL,
  project_id    CHAR(36)    NOT NULL,
  -- кто совершил действие. NULL = система/агент.
  actor_user_id CHAR(36)        NULL,
  -- task_created | task_status_changed | task_deleted | task_commented |
  -- project_created | project_archived | project_deleted |
  -- member_added | member_removed | member_role_changed
  kind          VARCHAR(40) NOT NULL,
  -- денормализованный payload (excerpt'ы/имена/статусы) — чтобы лента читалась без
  -- джойнов и переживала удаление задачи/проекта (показываем «что было»).
  payload       JSON            NULL,
  created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ae_ws_created (workspace_id, created_at),
  KEY idx_ae_project_created (project_id, created_at),
  KEY idx_ae_created (created_at),
  CONSTRAINT fk_ae_ws      FOREIGN KEY (workspace_id)  REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_ae_project FOREIGN KEY (project_id)    REFERENCES projects(id)   ON DELETE CASCADE,
  CONSTRAINT fk_ae_actor   FOREIGN KEY (actor_user_id) REFERENCES users(id)      ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
