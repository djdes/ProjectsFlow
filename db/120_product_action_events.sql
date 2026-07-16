-- Обезличенная продуктовая телеметрия ключевых действий на странице проекта.
-- Содержимое задач, названия и введённые пользователем значения сюда не попадают.
CREATE TABLE product_action_events (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  project_id CHAR(36) NULL,
  action VARCHAR(40) NOT NULL,
  result ENUM('started', 'success', 'failure') NOT NULL,
  duration_ms INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_product_action_created (created_at),
  INDEX idx_product_action_project (project_id, action, created_at),
  INDEX idx_product_action_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
