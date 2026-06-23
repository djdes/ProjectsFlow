-- 073: Пространства (workspaces) — верхнеуровневый изолированный контейнер над проектами.
-- Каждый проект принадлежит ровно одному пространству; у пространства свои участники.
-- См. docs/superpowers/specs/2026-06-23-workspaces-and-sidebar-redesign-design.md.

CREATE TABLE IF NOT EXISTS workspaces (
  id            CHAR(36)     NOT NULL,
  name          VARCHAR(120) NOT NULL,
  icon          VARCHAR(16)      NULL,
  owner_user_id CHAR(36)     NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_workspaces_owner (owner_user_id),
  CONSTRAINT fk_workspaces_owner FOREIGN KEY (owner_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id CHAR(36) NOT NULL,
  user_id      CHAR(36) NOT NULL,
  role         ENUM('owner','member') NOT NULL DEFAULT 'member',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, user_id),
  KEY idx_wm_user (user_id),
  CONSTRAINT fk_wm_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_wm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS workspace_id CHAR(36) NULL AFTER id;
ALTER TABLE users    ADD COLUMN IF NOT EXISTS current_workspace_id CHAR(36) NULL;

-- Backfill: одно личное пространство на юзера, коррелируется по owner_user_id.
-- WHERE NOT EXISTS / INSERT IGNORE — чтобы повторный прогон после частичного сбоя
-- (раннер пишет в _migrations только при полном успехе) не плодил дубликаты.
INSERT INTO workspaces (id, name, owner_user_id)
SELECT UUID(), 'Личное', u.id FROM users u
WHERE NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.owner_user_id = u.id);

INSERT IGNORE INTO workspace_members (workspace_id, user_id, role)
SELECT id, owner_user_id, 'owner' FROM workspaces;

UPDATE projects p
JOIN workspaces w ON w.owner_user_id = p.owner_id
SET p.workspace_id = w.id;

-- Остальные участники проектов → members пространства (расшаренные проекты не теряются).
INSERT IGNORE INTO workspace_members (workspace_id, user_id, role)
SELECT p.workspace_id, pm.user_id, 'member'
FROM project_members pm
JOIN projects p ON p.id = pm.project_id
WHERE pm.user_id <> p.owner_id;

UPDATE users u
JOIN workspaces w ON w.owner_user_id = u.id
SET u.current_workspace_id = w.id;

-- После backfill: жёсткие констрейнты.
ALTER TABLE projects MODIFY COLUMN workspace_id CHAR(36) NOT NULL;
ALTER TABLE projects ADD CONSTRAINT fk_projects_workspace
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id);

-- Уникальность имени проекта теперь в рамках ПРОСТРАНСТВА, а не владельца: один и тот же
-- юзер может иметь одноимённые проекты в разных пространствах (см. spec — пространства
-- изолированы). Внутри пространства имя по-прежнему уникально.
ALTER TABLE projects DROP INDEX IF EXISTS uq_projects_owner_name;
ALTER TABLE projects ADD UNIQUE INDEX IF NOT EXISTS uq_projects_workspace_name (workspace_id, name);
-- ON DELETE SET NULL: удаление пространства не блокируется чужим current_workspace_id;
-- приложение лениво переразрешает NULL current в любое доступное пространство.
ALTER TABLE users ADD CONSTRAINT fk_users_current_workspace
  FOREIGN KEY (current_workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;
