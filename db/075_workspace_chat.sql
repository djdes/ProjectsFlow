-- 075: общий чат пространства (workspace chat). Один канал на пространство, где
-- переписываются все его участники (workspace_members). См.
-- docs/superpowers/specs/2026-06-23-workspace-chat-and-sidebar-nav-design.md.
-- Прим.: 074 занят параллельной веткой recent-task-views, поэтому чат — 075.

-- Сообщения. seq — глобально-монотонный курсор (AUTO_INCREMENT): стабильная сортировка,
-- пагинация (beforeSeq/afterSeq) и replay для SSE без гонок per-workspace счётчика.
-- Зеркало seq из live-сессий. Удаление мягкое (deleted_at → tombstone «Сообщение удалено»).
CREATE TABLE IF NOT EXISTS workspace_chat_messages (
  id             CHAR(36)  NOT NULL,
  seq            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id   CHAR(36)  NOT NULL,
  author_user_id CHAR(36)  NOT NULL,
  body           TEXT      NOT NULL,
  reply_to_id    CHAR(36)      NULL,
  created_at     DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at      DATETIME      NULL,
  deleted_at     DATETIME      NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wcm_seq (seq),
  KEY idx_wcm_ws_seq (workspace_id, seq),
  CONSTRAINT fk_wcm_ws     FOREIGN KEY (workspace_id)   REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_wcm_author FOREIGN KEY (author_user_id) REFERENCES users(id),
  CONSTRAINT fk_wcm_reply  FOREIGN KEY (reply_to_id)    REFERENCES workspace_chat_messages(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Реакции: один юзер — одна и та же эмодзи на сообщение максимум один раз.
CREATE TABLE IF NOT EXISTS workspace_chat_reactions (
  message_id CHAR(36)    NOT NULL,
  user_id    CHAR(36)    NOT NULL,
  emoji      VARCHAR(16) NOT NULL,
  created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, user_id, emoji),
  KEY idx_wcr_message (message_id),
  CONSTRAINT fk_wcr_message FOREIGN KEY (message_id) REFERENCES workspace_chat_messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_wcr_user    FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Прочитанное: последний прочитанный seq на (пространство, юзер) → счётчик непрочитанного.
CREATE TABLE IF NOT EXISTS workspace_chat_reads (
  workspace_id  CHAR(36)        NOT NULL,
  user_id       CHAR(36)        NOT NULL,
  last_read_seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, user_id),
  CONSTRAINT fk_wcrd_ws   FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_wcrd_user FOREIGN KEY (user_id)      REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Вложения сообщений. Бинарь лежит в AttachmentStorage (FS/S3) по storage_key.
CREATE TABLE IF NOT EXISTS workspace_chat_attachments (
  id          CHAR(36)     NOT NULL,
  message_id  CHAR(36)     NOT NULL,
  storage_key VARCHAR(500) NOT NULL,
  filename    VARCHAR(255) NOT NULL,
  mime_type   VARCHAR(100) NOT NULL,
  size_bytes  INT          NOT NULL,
  width       INT              NULL,
  height      INT              NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_wca_message (message_id),
  CONSTRAINT fk_wca_message FOREIGN KEY (message_id) REFERENCES workspace_chat_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
