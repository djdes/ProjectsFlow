-- db/024_member_notification_prefs.sql
-- Пер-участниковые настройки email-оповещений по проекту. Матрица «тип события × источник
-- (team/mcp)» хранится как JSON. NULL = дефолты (team=on, mcp=off), резолвятся в коде —
-- поэтому без литерального DEFAULT (обходит JSON-default-квирки MariaDB) и без бэкфилла.

ALTER TABLE project_members
  ADD COLUMN notification_prefs JSON NULL;
