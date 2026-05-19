-- 010: переход от 1 user = 1 project к multi-tenancy. Таблица project_members
-- становится единственным источником доступа; projects.owner_id оставляем как кеш
-- для отката (дропнем отдельной миграцией спустя несколько релизов).
--
-- См. docs/superpowers/specs/2026-05-19-multi-tenant-projects-design.md (фаза P1).

CREATE TABLE IF NOT EXISTS project_members (
  project_id   CHAR(36)     NOT NULL,
  user_id      CHAR(36)     NOT NULL,
  role         ENUM('owner', 'editor', 'viewer') NOT NULL,
  joined_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, user_id),
  KEY idx_project_members_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Бекфилл: каждый существующий проект получает строку (owner_id, role='owner').
-- IGNORE чтобы повторный прогон миграции не падал на дубликатах.
INSERT IGNORE INTO project_members (project_id, user_id, role)
SELECT id, owner_id, 'owner' FROM projects;
