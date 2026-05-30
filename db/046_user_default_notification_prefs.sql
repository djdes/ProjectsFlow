-- Глобальные дефолтные email-notification prefs пользователя.
-- Когда юзер вступает в проект, эти настройки копируются как начальные
-- per-project notification_prefs в project_members. Также через API можно
-- применить их ко всем существующим проектам разом.
ALTER TABLE users
  ADD COLUMN default_notification_prefs JSON DEFAULT NULL
  AFTER tg_notification_prefs;
