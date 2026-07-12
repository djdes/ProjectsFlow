-- Кастомные свойства задач (Notion custom properties): определения пер-проект +
-- значения пер-задача. Значение хранится строкой (JSON-encoded по типу свойства).
-- Явный COLLATE — иначе general_ci и не джойнится с projects (см. db/104).
CREATE TABLE task_properties (
  id CHAR(36) NOT NULL PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  name VARCHAR(64) NOT NULL,
  -- text | number | select | multi_select | date | checkbox | url
  type VARCHAR(16) NOT NULL,
  -- Для select/multi_select: JSON-массив опций [{id,label,color}].
  options LONGTEXT NULL,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_task_properties_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE task_property_values (
  task_id CHAR(36) NOT NULL,
  property_id CHAR(36) NOT NULL,
  -- text/url: строка; number: '3.14'; select: id опции; multi_select: JSON-массив
  -- id опций; date: 'YYYY-MM-DD'; checkbox: '1'/''. NULL/'' = пусто.
  value TEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id, property_id),
  INDEX idx_task_property_values_property (property_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
