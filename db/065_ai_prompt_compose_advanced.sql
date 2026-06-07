-- db/065_ai_prompt_compose_advanced.sql
-- Ленивый «Продвинутый» вариант compose: pass-2 выносится в отдельный job-режим.
--
-- Раньше один job mode='compose' делал ОБА прохода opus подряд (разбивка+«Простой» →
-- «Продвинутый»), из-за чего pass-1 упирался в watchdog и падал с compose_pass1:timeout.
-- Теперь:
--   * mode='compose'          — только pass-1 (разбивка + «Простой» + классификация), быстрая модель;
--   * mode='compose-advanced' — только pass-2 («Продвинутый» по сегментам pass-1), запускается лениво
--                               из UI при открытии вкладки «Продвинутый».
--
-- Добавляем значение в конец ENUM — на MariaDB/MySQL это INSTANT-операция (метаданные,
-- без перестройки таблицы и без блокировки). Существующие строки не затрагиваются.
ALTER TABLE ai_prompt_jobs
  MODIFY COLUMN mode ENUM('improve','compose','compose-advanced') NOT NULL DEFAULT 'improve';
