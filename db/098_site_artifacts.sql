-- db/098 — задеплоенный статический результат проекта (self-serve воркер-раннер, M3).
-- Диспетчер собирает статику и заливает её; сервер отдаёт на <slug>.projectsflow.ru.
-- Одна строка на проект (PK project_id) — храним только последний деплой.
-- slug — ОТДЕЛЬНЫЙ случайный поддомен-slug, НЕЗАВИСИМЫЙ от public_slug доски (db/096):
--   публичный результат живёт своей жизнью, даже если публичный канбан выключен.
--   Генерится при первом деплое, дальше не меняется. Ссылка «есть только у владельца».
-- Без схемного FK на projects (в этой БД каскад чистится вручную в deleteCascade; схемный
-- FK давал errno 150 из-за несовпадения collation project_id/projects.id).
CREATE TABLE IF NOT EXISTS site_artifacts (
  project_id   CHAR(36)     NOT NULL PRIMARY KEY,
  slug         VARCHAR(64)  NOT NULL,
  file_count   INT          NOT NULL DEFAULT 0,
  bytes        BIGINT       NOT NULL DEFAULT 0,
  published_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_site_artifacts_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
