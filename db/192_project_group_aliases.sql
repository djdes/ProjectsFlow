-- db/192_project_group_aliases.sql
-- Выбор проекта из сообщения рабочей Telegram-группы (spec 2026-11-17, раздел 2):
--   aliases           — привычные названия проекта («конфиг», «планер»), JSON-массив строк;
--   short_description — коротко, что это за проект: подсказка ИИ-выбору проекта.
-- NULL — не задано. Правят владелец проекта и владелец/руководитель пространства.

ALTER TABLE projects
  ADD COLUMN aliases JSON NULL,
  ADD COLUMN short_description VARCHAR(300) NULL;
