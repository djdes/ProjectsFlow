-- Иконка задачи (эмодзи / lucide:Name[:color] / data-URL картинки). TEXT — влезает и data-URL.
ALTER TABLE tasks ADD COLUMN icon TEXT NULL DEFAULT NULL AFTER description;
-- Иконка проекта тоже должна вмещать lucide:Name:color и data-URL — расширяем с varchar(16) до TEXT.
ALTER TABLE projects MODIFY COLUMN icon TEXT NULL DEFAULT NULL;
