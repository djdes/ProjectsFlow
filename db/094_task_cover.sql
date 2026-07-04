-- Обложка задачи (Notion-style): CSS-градиент/пресет или data-URL картинки. TEXT — влезает data-URL.
ALTER TABLE tasks ADD COLUMN cover TEXT NULL DEFAULT NULL AFTER icon;
-- Вертикальное положение фокуса обложки (0..100), как у проекта. DEFAULT 50 = центр.
ALTER TABLE tasks ADD COLUMN cover_position INT NOT NULL DEFAULT 50 AFTER cover;
