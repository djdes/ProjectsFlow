-- 099_password_reset_tokens.sql — токены сброса пароля («Забыли пароль», U2).
-- Юзер запрашивает сброс по email → создаётся одноразовый токен с TTL, ссылка уходит
-- письмом на {appUrl}/reset-password?token=... . В БД храним SHA-256(token) (token_hash),
-- сам plaintext-токен живёт только в письме — дамп БД не даёт активных токенов.
-- used_at != NULL — токен уже использован (одноразовый). expires_at — TTL (1 час).
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          CHAR(36)     NOT NULL,
  user_id     CHAR(36)     NOT NULL,
  token_hash  VARCHAR(64)  NOT NULL,
  used_at     TIMESTAMP    NULL,
  expires_at  TIMESTAMP    NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_password_reset_token_hash (token_hash),
  KEY idx_password_reset_user (user_id),
  KEY idx_password_reset_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
