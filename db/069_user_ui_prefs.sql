-- 069: Персональные UI-настройки клиента (обобщённый bag preferences).
-- users.ui_prefs — JSON-карта клиентских настроек. Сейчас хранит { inboxAssignedGrouping }
--   (режим группировки блока «Поручено мне» на «Входящих»). NULL = дефолты.
--   В духе default_kanban_colors (db/057): рассчитан на расширение новыми ключами без
--   отдельной миграции per-настройку. Резолвится/мержится на лету (read-merge-write).
-- Идемпотентность: ADD COLUMN IF NOT EXISTS (MariaDB) + трекинг в _migrations.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ui_prefs JSON DEFAULT NULL
  AFTER default_kanban_colors;
