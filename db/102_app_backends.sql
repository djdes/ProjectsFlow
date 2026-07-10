-- db/102 — реестр бэкендов пользовательских приложений (self-serve app backend, мультитенант).
-- Одна строка на проект. САМИ данные приложения (юзеры, таблицы) живут в отдельном SQLite-файле
-- на диске (apps-data/<project_id>.sqlite); здесь — только метаданные: статус, объявленная схема,
-- хеш app-ключа и учёт квоты (usage/limit). Дизайн: docs/superpowers/specs/2026-07-10-app-backend-multitenant-design.md
-- Без схемного FK на projects (как db/098: FK давал errno 150 из-за несовпадения collation
-- project_id/projects.id); каскадная чистка при удалении проекта — вручную в deleteCascade.
CREATE TABLE IF NOT EXISTS app_backends (
  project_id          CHAR(36)              NOT NULL PRIMARY KEY,
  status              ENUM('none','active') NOT NULL DEFAULT 'none',
  schema_json         MEDIUMTEXT            NULL,
  app_key_hash        VARCHAR(255)          NULL,
  usage_bytes         BIGINT                NOT NULL DEFAULT 0,
  storage_limit_bytes BIGINT                NOT NULL DEFAULT 104857600, -- 100 МБ
  created_at          TIMESTAMP             NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP             NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
