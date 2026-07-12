-- 111: invite-ссылки в ПРОСТРАНСТВА (замена per-project приглашений). Один токен =
-- одноразовый, TTL 7 дней (см. CreateWorkspaceInvite use-case). Зеркало project_invites
-- (db/011); project_invites замораживается — новые не создаются, старые токены
-- продолжают работать (accept зачисляет в пространство проекта, код-адаптация).
-- email — информационное «для кого предназначался», mismatch НЕ блокирует accept.
-- См. docs/superpowers/specs/2026-07-13-unified-workspace-and-instant-delegation-design.md §3.1.

CREATE TABLE IF NOT EXISTS workspace_invites (
  id                   CHAR(36)     NOT NULL,
  workspace_id         CHAR(36)     NOT NULL,
  role                 ENUM('editor','viewer') NOT NULL DEFAULT 'editor',
  -- 32-byte hex (как project_invites.token). UNIQUE — security-критично.
  token                CHAR(64)     NOT NULL,
  email                VARCHAR(255) NULL,
  expires_at           TIMESTAMP    NOT NULL,
  accepted_at          TIMESTAMP    NULL,
  accepted_by_user_id  CHAR(36)     NULL,
  created_by_user_id   CHAR(36)     NOT NULL,
  created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ws_invites_token (token),
  KEY idx_ws_invites_workspace (workspace_id),
  KEY idx_ws_invites_expires (expires_at),
  CONSTRAINT fk_ws_invites_workspace FOREIGN KEY (workspace_id)
    REFERENCES workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
