-- db/101_close_proposals.sql
-- EOD/BOD-автоматизации (план sunny-spinning-sun.md). Фаза 1: 17:00 «предложить закрыть».
-- Переиспользуем подсистему commit-sync (db/072): планировщик по МСК → LLM-job → диспетчер
-- сопоставляет текст коммита ↔ описание задачи. Меняем финальный шаг: вместо авто-перемещения
-- по порогу возраста — создаём ПРЕДЛОЖЕНИЕ закрыть (human-in-the-loop), подтвердить может любой
-- участник (TG-кнопка / in-app). Эта миграция также добавляет настройки для Фаз 2 (17:20 EOD)
-- и 3 (утренний «план дня»). Решение владельца: автоматизации ВКЛ по умолчанию на ВСЕХ проектах
-- (opt-out) — миграция включает существующим и бэкфилит строку каждому проекту.

-- 1) Новые поля настроек автоматизации (одна строка project_automation на проект, db/045).
ALTER TABLE project_automation
  -- Как поступать с совпадениями commit-sync. 'propose' (дефолт) — создать предложение закрыть;
  -- 'auto' — прежнее поведение (двигать по порогу возраста). Дефолт = человек-в-цикле.
  ADD COLUMN commit_sync_action     ENUM('propose','auto') NOT NULL DEFAULT 'propose',
  -- Фаза 2: персональное напоминание «актуализируй перед уходом». ВКЛ по умолчанию.
  ADD COLUMN eod_reminder_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN eod_reminder_hour        TINYINT NOT NULL DEFAULT 17,  -- 0..23 (Europe/Moscow)
  ADD COLUMN eod_reminder_minute      TINYINT NOT NULL DEFAULT 20,  -- 0..59
  ADD COLUMN eod_reminder_last_run_on DATE    NULL,                 -- МSK-дата последнего прогона
  -- Фаза 3: утренняя секция «с чего начать» в дневном дайджесте (время — у самого дайджеста).
  ADD COLUMN daily_plan_enabled       BOOLEAN NOT NULL DEFAULT TRUE;

-- 2) 17:00 «предложить закрыть» ВКЛ по умолчанию: меняем дефолты commit-sync под ритуал
--    (было enabled=FALSE, 3:00 из db/072) — теперь новые проекты получают ВКЛ в 17:00.
ALTER TABLE project_automation
  ALTER commit_sync_enabled SET DEFAULT TRUE,
  ALTER commit_sync_hour    SET DEFAULT 17,
  ALTER commit_sync_minute  SET DEFAULT 0;

-- 2a) Включаем на всех проектах, где commit-sync ещё не был включён (владелец: «вкл на всех»).
--     Им же ставим ритуальное время 17:00 (у них хранился неиспользуемый дефолт 3:00).
--     Уже включённые проекты НЕ трогаем — уважаем настроенное пользователем время.
UPDATE project_automation
  SET commit_sync_enabled = TRUE, commit_sync_hour = 17, commit_sync_minute = 0
  WHERE commit_sync_enabled = FALSE;

-- 3) Гарантируем строку автоматизации каждому НЕ-архивному проекту, чтобы планировщики
--    (commit-sync / EOD / daily-plan) видели ВСЕ проекты. Пропущенные раньше получают дефолты
--    (commit_sync_enabled=TRUE @ 17:00, eod=TRUE @ 17:20, daily_plan=TRUE). Поле enabled
--    (авто-генерация задач) остаётся FALSE — это отдельная фича.
INSERT INTO project_automation (project_id)
  SELECT p.id FROM projects p
  WHERE p.status <> 'archived'
    AND NOT EXISTS (SELECT 1 FROM project_automation a WHERE a.project_id = p.id);

-- 4) Снимок действия в самой job'е (UI мог поменять настройку после enqueue — авторитетен снапшот).
ALTER TABLE commit_sync_jobs
  ADD COLUMN action ENUM('propose','auto') NOT NULL DEFAULT 'propose';

-- 5) Предложения закрыть задачу. Даёт идемпотентность подтверждения, аудит и in-app карточку.
CREATE TABLE IF NOT EXISTS task_close_proposals (
  id             CHAR(36)     NOT NULL,
  project_id     CHAR(36)     NOT NULL,
  task_id        CHAR(36)     NOT NULL,
  -- Коммит, по которому задача выглядит выполненной (видимая ссылка в предложении).
  commit_sha     VARCHAR(64)  NOT NULL,
  -- Обоснование от модели («почему выглядит готовой»).
  reason         VARCHAR(1000) NULL,
  -- Job-источник (аудит/трассировка обратно к прогону commit-sync).
  source_job_id  CHAR(36)     NULL,
  status         ENUM('open','confirmed','dismissed','expired') NOT NULL DEFAULT 'open',
  -- Кто и когда разрешил (подтвердил/отклонил). NULL пока open.
  resolved_by    CHAR(36)     NULL,
  resolved_at    TIMESTAMP    NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- Одно открытое предложение на задачу+коммит — анти-дубль при повторных прогонах.
  UNIQUE KEY uq_tcp_task_commit (task_id, commit_sha),
  KEY idx_tcp_project_status (project_id, status, created_at),
  KEY idx_tcp_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
