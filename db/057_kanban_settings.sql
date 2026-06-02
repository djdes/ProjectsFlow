-- 057: Кастомизация канбан-досок.
-- projects.kanban_settings — ОБЩИЕ (на весь проект) настройки колонок: цвет, переименованный
--   заголовок, флаг скрытия. Карта status→{color,label,hidden}. NULL = встроенные дефолты.
--   В отличие от per-member notification_prefs (project_members) — это shared-состояние:
--   все участники проекта видят одинаковую кастомизацию доски.
-- users.default_kanban_colors — персональная карта дефолтных цветов колонок, применяется
--   как fallback ко всем проектам юзера (резолвится на лету, НЕ копируется при создании).
-- Идемпотентность: ADD COLUMN IF NOT EXISTS (MariaDB) + трекинг в _migrations.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS kanban_settings JSON DEFAULT NULL
  AFTER dispatcher_user_id;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS default_kanban_colors JSON DEFAULT NULL
  AFTER default_notification_prefs;
