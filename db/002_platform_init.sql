-- 002: pivot from landing to platform schema.
-- DROPs the legacy `projects` table (landing's "история проектов" archive)
-- and creates platform tables: users, sessions, projects, user_github_tokens, secrets.
--
-- Идемпотентность обеспечивается tracking-таблицей `_migrations` в scripts/migrate.mjs:
-- этот файл применится один раз. DROP/CREATE заверну в IF (NOT) EXISTS, чтобы безопасно
-- повторно прогонять ручную migrate в dev-окружении.

-- ============================================================
-- 1. Drop legacy projects table (landing schema with year/period/body)
-- ============================================================

DROP TABLE IF EXISTS projects;

-- ============================================================
-- 2. Platform tables
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id              CHAR(36)     NOT NULL,
  email           VARCHAR(255) NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  display_name    VARCHAR(80)  NOT NULL,
  avatar_url      VARCHAR(500)     NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id          CHAR(36)  NOT NULL,
  user_id     CHAR(36)  NOT NULL,
  expires_at  TIMESTAMP NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sessions_user (user_id),
  KEY idx_sessions_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS projects (
  id                 CHAR(36)     NOT NULL,
  owner_id           CHAR(36)     NOT NULL,
  name               VARCHAR(80)  NOT NULL,
  status             ENUM('active','paused','archived') NOT NULL DEFAULT 'active',
  git_repo_url       VARCHAR(500)     NULL,
  kb_repo_full_name  VARCHAR(255)     NULL,
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_projects_owner_name (owner_id, name),
  KEY idx_projects_owner (owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_github_tokens (
  user_id         CHAR(36)     NOT NULL,
  access_token    VARCHAR(500) NOT NULL,
  scopes          VARCHAR(500) NOT NULL DEFAULT '',
  github_login    VARCHAR(255) NOT NULL,
  github_user_id  VARCHAR(50)  NOT NULL,
  connected_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS secrets (
  id          CHAR(36)      NOT NULL,
  user_id     CHAR(36)      NOT NULL,
  secret_key  VARCHAR(500)  NOT NULL,
  encrypted   VARCHAR(2000) NOT NULL,
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_secrets_user_key (user_id, secret_key),
  KEY idx_secrets_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
