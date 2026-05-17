-- 005: agent_tokens — долгоживущие токены для внешних агентов (Claude Code MCP-сервер
-- и пр.). Хранится bcrypt-хеш (не plaintext). Plaintext отдаётся юзеру один раз при
-- создании, потом он копирует его в config агента.

CREATE TABLE IF NOT EXISTS agent_tokens (
  id              CHAR(36)      NOT NULL,
  user_id         CHAR(36)      NOT NULL,
  name            VARCHAR(120)  NOT NULL,
  token_hash      VARCHAR(255)  NOT NULL,
  token_prefix    VARCHAR(20)   NOT NULL,   -- первые ~10 символов plaintext'а для display'а в списке ("pfat_a1b2c3...")
  created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at    TIMESTAMP         NULL,
  revoked_at      TIMESTAMP         NULL,
  PRIMARY KEY (id),
  KEY idx_agent_tokens_user (user_id),
  KEY idx_agent_tokens_hash (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
