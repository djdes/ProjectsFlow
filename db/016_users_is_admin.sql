-- db/016_users_is_admin.sql
-- Системный admin/root-флаг. Сид-пользователь (admin@projectsflow.ru) получает
-- глобальный доступ ко всем проектам через admin-bypass в requireProjectAccess.
-- Аддитивная миграция: дефолт FALSE, существующие юзеры не затрагиваются.

ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE;
