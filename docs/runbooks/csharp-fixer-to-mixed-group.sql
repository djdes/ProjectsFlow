-- Перевод чата CSharpFixer в рабочую группу «Скрипты / Сайт YB» в СМЕШАННОМ режиме (mixed).
-- Решение владельца 2026-11-18: «если указан исполнитель — задача человеку; если не указан
-- исполнитель — воркеру». Заменяет docs/runbooks/csharp-fixer-to-incident-group.sql.
--
-- НЕ миграция: в db/ не кладём, автоматически не запускается. Выполняет администратор вручную,
-- в окне переключения. Скрипт идемпотентен: повторный запуск ничего не ломает.
--
-- Порядок переключения:
--   0. Задеплоить релиз с db/193_telegram_group_mixed_mode.sql (enum mode += 'mixed',
--      projects.group_full_run_default) и применить миграцию.
--   1. На сервере PF задать TELEGRAM_ORIGIN_SIGNING_KEY (32+ символов; общий секрет с воркером),
--      если ещё не задан.
--   2. Подставить значения в SET ниже: id чата (CSHARP_FIXER_CHAT_ID), id пространства YesBeat
--      и id пользователя, от имени которого ставятся задачи воркеру (владелец/руководитель YesBeat;
--      у него должен быть доступ ко всем 7 проектам).
--   3. Выполнить блок «Проверка» — должны найтись все 7 проектов (6 C# + Yesbeat) в пространстве.
--   4. Выполнить блок «Перевод» в транзакции.
--   5. Убрать CSHARP_FIXER_CHAT_ID / CSHARP_FIXER_PROJECT_ID / CSHARP_FIXER_SIGNING_KEY из env и
--      перезапустить сервер. Пока env задан, чат обслуживается старым путём CSharpFixer
--      (env имеет приоритет над режимом группы).
--
-- Проекты группы:
--   C#Config            b87d9337-1bdf-45ba-b87a-c035bddeeb48  (полный прогон)
--   PlanningProduct     97860179-5a7c-4dc7-bd98-f2852332fed4  (полный прогон)
--   C#MasterWatcher     e642df83-40f0-4bc5-a5de-1cc964d87040  (полный прогон)
--   C#FilterMusic       6f64237a-03e5-4fbe-8f52-7378eee8cdc0  (полный прогон)
--   IndividualServices  72dd0800-00bd-4fc8-a0d7-9315cd4691f5  (полный прогон)
--   dirMp3FTP           по git_repo_url djdes/dirMp3FTP        (полный прогон)
--   Yesbeat             286b58f5-dea7-4232-bb5b-c0ccf0dedff3  (обычный прогон: флаг не трогаем)

SET @chat_id      = 0;    -- CSHARP_FIXER_CHAT_ID (отрицательное число)
SET @workspace_id = '';   -- id пространства YesBeat (workspaces.id, kind='team')
SET @owner_id     = '';   -- users.id владельца/руководителя YesBeat
SET @yesbeat_id   = '286b58f5-dea7-4232-bb5b-c0ccf0dedff3';

-- ---- Проверка (только чтение) ----
SELECT id, name, kind FROM workspaces WHERE id = @workspace_id;
SELECT tg_chat_id, workspace_id, status, mode FROM workspace_telegram_groups WHERE tg_chat_id = @chat_id;

DROP TEMPORARY TABLE IF EXISTS tmp_mixed_group_projects;
CREATE TEMPORARY TABLE tmp_mixed_group_projects (project_id CHAR(36) PRIMARY KEY, full_run TINYINT(1) NOT NULL);
INSERT IGNORE INTO tmp_mixed_group_projects (project_id, full_run) VALUES
  ('b87d9337-1bdf-45ba-b87a-c035bddeeb48', 1),
  ('97860179-5a7c-4dc7-bd98-f2852332fed4', 1),
  ('e642df83-40f0-4bc5-a5de-1cc964d87040', 1),
  ('6f64237a-03e5-4fbe-8f52-7378eee8cdc0', 1),
  ('72dd0800-00bd-4fc8-a0d7-9315cd4691f5', 1),
  (@yesbeat_id, 0);
INSERT IGNORE INTO tmp_mixed_group_projects (project_id, full_run)
SELECT p.id, 1
FROM projects p
WHERE p.workspace_id = @workspace_id
  AND LOWER(TRIM(TRAILING '.git' FROM TRIM(TRAILING '/' FROM p.git_repo_url))) = 'https://github.com/djdes/dirmp3ftp';

-- Ожидается 7 строк, у всех in_workspace = 1.
SELECT t.project_id, p.name, p.git_repo_url, t.full_run,
       (p.workspace_id = @workspace_id AND p.is_inbox = 0) AS in_workspace
FROM tmp_mixed_group_projects t
LEFT JOIN projects p ON p.id = t.project_id;

-- ---- Перевод ----
START TRANSACTION;

-- Группа становится активной рабочей группой YesBeat в смешанном режиме. Если группа уже
-- числится в другом пространстве — UPDATE перезапишет её; проверьте блок выше перед запуском.
INSERT INTO workspace_telegram_groups (tg_chat_id, workspace_id, title, added_by_user_id, status, mode)
VALUES (@chat_id, @workspace_id, 'Скрипты / Сайт YB', @owner_id, 'active', 'mixed')
ON DUPLICATE KEY UPDATE
  workspace_id = VALUES(workspace_id),
  added_by_user_id = VALUES(added_by_user_id),
  status = 'active',
  mode = 'mixed',
  transfer_to_workspace_id = NULL,
  transfer_requested_by_user_id = NULL,
  transfer_target_status = NULL,
  transfer_requested_at = NULL;

-- Список проектов группы целиком: 6 C#-проектов + Yesbeat (только проекты пространства группы).
DELETE FROM telegram_group_projects WHERE tg_chat_id = @chat_id;
INSERT INTO telegram_group_projects (tg_chat_id, project_id, added_by_user_id)
SELECT @chat_id, p.id, @owner_id
FROM tmp_mixed_group_projects t
JOIN projects p ON p.id = t.project_id
WHERE p.workspace_id = @workspace_id AND p.is_inbox = 0;

-- «Полный прогон по умолчанию для задач из групп» — только C#-проектам (там есть конвейер Ralph).
UPDATE projects p
JOIN tmp_mixed_group_projects t ON t.project_id = p.id AND t.full_run = 1
SET p.group_full_run_default = 1
WHERE p.workspace_id = @workspace_id;

SELECT COUNT(*) AS group_projects FROM telegram_group_projects WHERE tg_chat_id = @chat_id;
SELECT COUNT(*) AS full_run_projects
FROM projects p JOIN tmp_mixed_group_projects t ON t.project_id = p.id
WHERE p.group_full_run_default = 1;
-- Ожидается group_projects = 7 и full_run_projects = 6. Иначе — ROLLBACK и проверьте проекты.
COMMIT;

DROP TEMPORARY TABLE IF EXISTS tmp_mixed_group_projects;
