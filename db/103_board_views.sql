-- Пользовательские вью доски проекта (Notion-style, план board-views-design):
-- несколько именованных представлений задач (kanban/table/list/calendar) на проект.
-- Дефолтная вкладка «Доска» (канбан) — неявная и в таблице НЕ хранится: здесь только
-- вью, созданные пользователями через «+». Общие на проект (как kanban settings).
CREATE TABLE IF NOT EXISTS board_views (
  id CHAR(36) NOT NULL PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  name VARCHAR(64) NOT NULL,
  type ENUM('kanban', 'table', 'list', 'calendar') NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_by CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_board_views_project (project_id, sort_order)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
