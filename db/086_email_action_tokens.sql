-- 086_email_action_tokens.sql — токены действий из писем-сводок (one-click «Завершить»/«Комментировать»).
-- Каждый токен привязан к (action, task, project, user=получатель сводки). complete — одноразовый
-- (used_at), comment — многоразовый до истечения. Публичные эндпоинты /api/email-actions/:token
-- валидируют токен по БД (как инвайты — opaque random). См. план gleaming-munching-locket.
CREATE TABLE IF NOT EXISTS email_action_tokens (
  id          CHAR(36)                    NOT NULL,
  token       VARCHAR(64)                 NOT NULL,
  action      ENUM('complete','comment')  NOT NULL,
  task_id     CHAR(36)                    NOT NULL,
  project_id  CHAR(36)                    NOT NULL,
  user_id     CHAR(36)                    NOT NULL,
  used_at     TIMESTAMP                   NULL,
  expires_at  TIMESTAMP                   NOT NULL,
  created_at  TIMESTAMP                   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_email_action_token (token),
  KEY idx_email_action_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
