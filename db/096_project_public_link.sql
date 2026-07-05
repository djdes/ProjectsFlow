-- db/096 — публичная ссылка доски проекта (Publish to web, Notion-style).
-- public_slug      — случайный неугадываемый slug вида `adjective-noun-hex`
--                    (напр. cookie-opinion-b69). URL доски: projectsflow.ru/p/<public_slug>.
--                    NULL = проект никогда не публиковали. UNIQUE (несколько NULL допустимы).
--                    Slug живёт вечно после первой публикации: Unpublish лишь гасит is_public,
--                    повторный Publish возвращает тот же URL (как в Notion).
-- is_public        — опубликовано сейчас или нет. Анонимный роут /api/public/boards/<slug>
--                    отдаёт доску только при is_public=1, иначе 404.
-- public_indexing  — тоггл «Search engine indexing». По умолчанию Off: публичная страница
--                    ставит <meta name="robots" content="noindex"> пока флаг выключен.
-- published_at     — момент ПЕРВОЙ публикации (аналитика). Живёт только в БД, в domain не читается.
ALTER TABLE projects
  ADD COLUMN public_slug VARCHAR(64) NULL AFTER cover_position,
  ADD COLUMN is_public TINYINT(1) NOT NULL DEFAULT 0 AFTER public_slug,
  ADD COLUMN public_indexing TINYINT(1) NOT NULL DEFAULT 0 AFTER is_public,
  ADD COLUMN published_at TIMESTAMP NULL DEFAULT NULL AFTER public_indexing;

-- Уникальность slug + быстрый lookup по slug для анонимного роута.
ALTER TABLE projects
  ADD UNIQUE INDEX uq_projects_public_slug (public_slug);
