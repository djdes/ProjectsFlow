-- Полный набор режимов страницы проекта (Notion-style views).
-- Существующие значения сохраняются; меняется только допустимый ENUM.
ALTER TABLE board_views
  MODIFY COLUMN type ENUM(
    'kanban',
    'table',
    'list',
    'calendar',
    'timeline',
    'gallery',
    'chart',
    'feed',
    'map',
    'dashboard',
    'form'
  ) NOT NULL;
