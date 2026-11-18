-- db/193_telegram_group_mixed_mode.sql
-- Смешанный режим рабочей Telegram-группы (решение владельца 2026-11-18): упоминание бота
-- с исполнителем (@username / имя / «мне») — задача человеку, как в обычной группе; без
-- исполнителя — задача воркеру (как инцидент: автору аккаунт не нужен, ответы — в группу).
--   workspace_telegram_groups.mode += 'mixed';
--   projects.group_full_run_default — задачи воркеру из групп ставить с полным прогоном
--   (runMode='full'): ProjectsFlow не знает, где у проекта есть конвейер Ralph. 0 — 'quick'.
-- Правят: режим — владелец/руководитель пространства; флаг — как подсказки группы (db/192).

ALTER TABLE workspace_telegram_groups
  MODIFY COLUMN mode ENUM('standard','incident','mixed') NOT NULL DEFAULT 'standard';

ALTER TABLE projects
  ADD COLUMN group_full_run_default TINYINT(1) NOT NULL DEFAULT 0;
