-- Недавно открытые задачи на юзера (кросс-девайс источник для блока «Недавнее» в сайдбаре).
-- Одна строка на (user, task): открытие задачи апсертит viewed_at = CURRENT_TIMESTAMP.
-- Доступ-фильтр на чтении — через project_members (НЕ привязываемся к workspace, чтобы
-- «Недавнее» работало кросс-воркспейсно; deep-link сам переключит активное пространство).
CREATE TABLE IF NOT EXISTS recent_task_views (
  user_id    CHAR(36)  NOT NULL,
  task_id    CHAR(36)  NOT NULL,
  project_id CHAR(36)  NOT NULL,
  viewed_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, task_id),
  KEY idx_recent_views_user_viewed (user_id, viewed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
