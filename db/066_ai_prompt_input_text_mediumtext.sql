-- db/066_ai_prompt_input_text_mediumtext.sql
-- Свободный текст пользователя (improve / compose pass-1) и JSON сегментов (compose-advanced)
-- едут в input_text. TEXT (≤65535 байт) маловат: 50000 символов кириллицы в utf8mb4 = ~100КБ.
-- Поднимаем до MEDIUMTEXT (16МБ) — как уже сделано для tasks.description (db/058) и
-- ai_prompt_jobs.improved_text / kb_context (db/060). Лимиты на уровне приложения:
-- 50000 символов свободного текста (= maxLength поля композера) / 200000 для advanced-payload.
ALTER TABLE ai_prompt_jobs MODIFY COLUMN input_text MEDIUMTEXT NOT NULL;
