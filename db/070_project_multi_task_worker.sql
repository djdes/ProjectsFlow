-- 070: Мультизадачный воркер проекта. Per-project opt-in: когда TRUE, Ralph-диспетчер
-- может выполнять до N задач этого проекта ОДНОВРЕМЕННО (а не строго одну за раз).
-- Предназначено для проектов, чьи задачи не меняют код и не конфликтуют в .git.
-- FALSE (по умолчанию) = старое поведение «1 проект = 1 задача» (backward-compat).
-- Кап параллелизма на проект задаётся на стороне диспетчера (env PF_PER_PROJECT_MULTITASK_CAP,
-- default 3); глобальный потолок PF_MAX_PARALLEL_WORKERS остаётся общим для всех проектов.
-- Менять флаг может любой участник проекта (viewer+) — это routing automation, не data access.
-- Идемпотентность: ADD COLUMN IF NOT EXISTS (MariaDB) + трекинг в _migrations.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS multi_task_worker BOOLEAN NOT NULL DEFAULT FALSE
  AFTER dispatcher_user_id;
