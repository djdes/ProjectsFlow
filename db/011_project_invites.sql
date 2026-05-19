-- 011: invite-ссылки в проекты. Один токен = одноразовый, TTL по умолчанию 7 дней
-- (см. CreateProjectInvite use-case). Owner копирует invite-URL руками — SMTP пока
-- не подключён, см. spec секция 7 (решение по SMTP — «потом»).
--
-- См. docs/superpowers/specs/2026-05-19-multi-tenant-projects-design.md.

CREATE TABLE IF NOT EXISTS project_invites (
  id                   CHAR(36)     NOT NULL,
  project_id           CHAR(36)     NOT NULL,
  role                 ENUM('editor', 'viewer') NOT NULL,
  -- 32-byte hex (как agent-token). UNIQUE — security-критично.
  token                CHAR(64)     NOT NULL,
  -- Email опционален: информационное поле «для кого предназначался» инвайт.
  -- Mismatch с email акцептора НЕ блокирует accept (см. spec секция 7, решение #2).
  email                VARCHAR(255) NULL,
  expires_at           TIMESTAMP    NOT NULL,
  accepted_at          TIMESTAMP    NULL,
  accepted_by_user_id  CHAR(36)     NULL,
  created_by_user_id   CHAR(36)     NOT NULL,
  created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invites_token (token),
  KEY idx_invites_project (project_id),
  KEY idx_invites_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
