-- Шаблоны задач (Notion Templates): заготовка задачи проекта, доступна в меню
-- «Создать ▾». Явный COLLATE — иначе general_ci и не джойнится с projects (см. db/104).
CREATE TABLE task_templates (
  id CHAR(36) NOT NULL PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  -- Имя шаблона в меню (не название задачи).
  name VARCHAR(64) NOT NULL,
  -- Заготовка: описание (title+body), статус, приоритет, иконка — как у tasks.
  description MEDIUMTEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'backlog',
  priority TINYINT UNSIGNED NULL,
  icon TEXT NULL,
  created_by CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_task_templates_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
