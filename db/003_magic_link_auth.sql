-- 003: passwordless auth — drop password_hash, add magic_tokens.
-- См. server/src/application/auth/RequestMagicLink.ts.
-- Токен в БД хранится как SHA-256 hex (64 chars). Сырой токен живёт только в письме.

ALTER TABLE users DROP COLUMN IF EXISTS password_hash;

CREATE TABLE IF NOT EXISTS magic_tokens (
  id           CHAR(36)     NOT NULL,
  email        VARCHAR(255) NOT NULL,
  token_hash   CHAR(64)     NOT NULL,
  expires_at   TIMESTAMP    NOT NULL,
  consumed_at  TIMESTAMP        NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_magic_tokens_hash (token_hash),
  KEY idx_magic_tokens_email (email),
  KEY idx_magic_tokens_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
