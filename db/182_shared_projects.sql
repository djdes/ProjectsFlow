-- 182: один проект в нескольких пространствах — доступ пространств и видимость задач.
-- См. docs/superpowers/specs/2026-11-12-shared-projects-across-workspaces-design.md.

-- Пространства проекта: основное — projects.workspace_id; здесь подключённые (доступ) и правило
-- видимости задач для каждого (строка основного хранит только его правило).
-- task_scope: all — все задачи проекта; own — созданные в этом пространстве; selected — свои и
-- из пространств visible_from (JSON-массив id).
CREATE TABLE IF NOT EXISTS project_workspace_access (
  project_id         CHAR(36)  NOT NULL,
  workspace_id       CHAR(36)  NOT NULL,
  task_scope         ENUM('all','own','selected') NOT NULL DEFAULT 'own',
  visible_from       JSON      NULL,
  created_by_user_id CHAR(36)  NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, workspace_id),
  KEY idx_pwa_workspace (workspace_id),
  CONSTRAINT fk_pwa_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT fk_pwa_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Персональное правило человека в общем проекте: заменяет правила пространств.
-- task_scope: all — все задачи; mine — только где он автор или ответственный; selected — из
-- пространств visible_from.
CREATE TABLE IF NOT EXISTS project_member_task_visibility (
  project_id         CHAR(36)  NOT NULL,
  user_id            CHAR(36)  NOT NULL,
  task_scope         ENUM('all','mine','selected') NOT NULL,
  visible_from       JSON      NULL,
  updated_by_user_id CHAR(36)  NULL,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, user_id),
  CONSTRAINT fk_pmtv_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT fk_pmtv_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Пространство, в котором задачу создали. NULL — основное пространство проекта (все прежние
-- задачи). Без внешнего ключа: удалённое или отключённое пространство читается как основное,
-- а FK на большой таблице задач потребовал бы её перестройки.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS origin_workspace_id CHAR(36) NULL;
ALTER TABLE tasks ADD INDEX IF NOT EXISTS idx_tasks_project_origin (project_id, origin_workspace_id);
