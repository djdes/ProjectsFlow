-- One pending, short-lived bot connection per account. Never store the URL token itself.
CREATE TABLE telegram_pairing_tokens (
  user_id CHAR(36) NOT NULL PRIMARY KEY,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME NOT NULL,
  UNIQUE KEY uq_telegram_pairing_token_hash (token_hash),
  CONSTRAINT fk_telegram_pairing_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
