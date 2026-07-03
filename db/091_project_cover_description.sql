-- db/091 — Notion-style шапка проекта: описание + обложка.
-- description  — свободный текст под названием проекта.
-- cover_url    — обложка: `gradient:<id>` (градиент из клиентской палитры) ИЛИ URL картинки
--                (внешняя ссылка / загруженный файл `/api/projects/:id/cover/<file>`).
-- cover_position — вертикальное позиционирование фона обложки в процентах (0–100), для
--                «переместить». По умолчанию 50 (центр).
ALTER TABLE projects
  ADD COLUMN description TEXT NULL AFTER kanban_settings,
  ADD COLUMN cover_url VARCHAR(500) NULL AFTER description,
  ADD COLUMN cover_position INT NOT NULL DEFAULT 50 AFTER cover_url;
