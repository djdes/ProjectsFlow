-- 009: комментарии к задачам. Текстовая обсуждалка внутри карточки — отдельно от
-- description (он один) и аттачей (картинки). Owner — тот же юзер что владеет проектом
-- (single-tenant); поле owner_user_id оставляем явным под будущую multi-tenancy.

CREATE TABLE IF NOT EXISTS task_comments (
  id            CHAR(36)      NOT NULL,
  task_id       CHAR(36)      NOT NULL,
  owner_user_id CHAR(36)      NOT NULL,
  body          TEXT          NOT NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_task_comments_task_created (task_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
