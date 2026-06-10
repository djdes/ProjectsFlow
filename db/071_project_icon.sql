-- Эмодзи-иконка проекта (Notion-style): показывается в сайдбаре, заголовке и крошках.
-- NULL = дефолтная папка. utf8mb4 уже включён глобально — эмодзи (включая составные
-- ZWJ-последовательности до ~16 символов) помещаются.
ALTER TABLE projects
  ADD COLUMN icon VARCHAR(16) NULL DEFAULT NULL AFTER name;
