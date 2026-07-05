-- Ежедневная сводка: опция «только по будням» (Пн–Пт МSK) — в выходные не тревожить.
-- Кому надо в выходные — зайдут сами и нажмут «Отправить сейчас».
ALTER TABLE project_digest_settings
  ADD COLUMN daily_weekdays_only BOOLEAN NOT NULL DEFAULT FALSE AFTER daily_statuses;
