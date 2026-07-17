-- ProjectsFlow supports four project task views: kanban, table, list and calendar.
-- Retired view definitions are removed; tasks and their data are not affected.
DELETE FROM board_views
WHERE type NOT IN ('kanban', 'table', 'list', 'calendar');

ALTER TABLE board_views
  MODIFY COLUMN type ENUM('kanban', 'table', 'list', 'calendar') NOT NULL;
