-- db/100 — постоянный слаг сайта-результата проекта. У каждого проекта свой адрес
-- <site_slug>.projectsflow.ru: ДО деплоя воркером сервер отдаёт HTML-заглушку «в разработке»,
-- ПОСЛЕ — задеплоенную статику (site_artifacts, db/098) на том же слаге. Заводится при создании
-- проекта (CreateProject); существующие бэкфиллим детерминированным slug из id (уникален).
ALTER TABLE projects
  ADD COLUMN site_slug VARCHAR(64) NULL AFTER app_repo_full_name;

UPDATE projects
  SET site_slug = LOWER(SUBSTRING(SHA2(CONCAT(id, 'site'), 256), 1, 12))
  WHERE site_slug IS NULL;

ALTER TABLE projects
  ADD UNIQUE INDEX IF NOT EXISTS uq_projects_site_slug (site_slug);
