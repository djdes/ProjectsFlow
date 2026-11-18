-- Перевод чата CSharpFixer в рабочую группу YesBeat с режимом incident.
-- Spec: docs/superpowers/specs/2026-11-17-telegram-group-projects-and-worker-orchestrator-design.md, раздел 3.
--
-- НЕ миграция: в db/ не кладём, автоматически не запускается. Выполняет администратор вручную,
-- в окне переключения (см. порядок ниже). Скрипт идемпотентен: повторный запуск ничего не ломает.
--
-- Порядок переключения:
--   1. На сервере PF задать TELEGRAM_ORIGIN_SIGNING_KEY (32+ символов; общий секрет с воркером).
--   2. Подставить значения в SET ниже: id чата (CSHARP_FIXER_CHAT_ID), id пространства YesBeat
--      и id пользователя, от имени которого ставятся задачи (владелец/руководитель YesBeat).
--   3. Выполнить блок «Проверка» — убедиться, что нашлись все 6 C#-проектов.
--   4. Выполнить блок «Перевод» в транзакции.
--   5. Убрать CSHARP_FIXER_CHAT_ID / CSHARP_FIXER_PROJECT_ID / CSHARP_FIXER_SIGNING_KEY из env и
--      перезапустить сервер. Пока env задан, чат обслуживается старым путём CSharpFixer
--      (env имеет приоритет над mode='incident').
--
-- Проекты — из каталога CSharpFixer (C:\www\C#Fixer\catalog.local.json, enabled=true), сопоставляем
-- по git_repo_url (djdes/<repo>), чтобы не зависеть от отображаемых названий в PF.

SET @chat_id      = 0;    -- CSHARP_FIXER_CHAT_ID (отрицательное число)
SET @workspace_id = '';   -- id пространства YesBeat (workspaces.id, kind='team')
SET @owner_id     = '';   -- users.id владельца/руководителя YesBeat

-- ---- Проверка (только чтение) ----
SELECT id, name, kind FROM workspaces WHERE id = @workspace_id;
SELECT tg_chat_id, workspace_id, status, mode FROM workspace_telegram_groups WHERE tg_chat_id = @chat_id;
SELECT p.id, p.name, p.git_repo_url
FROM projects p
WHERE p.workspace_id = @workspace_id
  AND LOWER(TRIM(TRAILING '.git' FROM TRIM(TRAILING '/' FROM p.git_repo_url))) IN (
    'https://github.com/djdes/config',
    'https://github.com/djdes/dirmp3ftp',
    'https://github.com/djdes/filtermusic',
    'https://github.com/djdes/individualservices',
    'https://github.com/djdes/masterwatcher',
    'https://github.com/djdes/planningproduct'
  );

-- ---- Перевод ----
START TRANSACTION;

-- Группа становится активной рабочей группой YesBeat в режиме incident. Если группа уже
-- числится в другом пространстве — UPDATE перезапишет её; проверьте блок выше перед запуском.
INSERT INTO workspace_telegram_groups (tg_chat_id, workspace_id, title, added_by_user_id, status, mode)
VALUES (@chat_id, @workspace_id, 'Скрипты / Сайт YB', @owner_id, 'active', 'incident')
ON DUPLICATE KEY UPDATE
  workspace_id = VALUES(workspace_id),
  added_by_user_id = VALUES(added_by_user_id),
  status = 'active',
  mode = 'incident',
  transfer_to_workspace_id = NULL,
  transfer_requested_by_user_id = NULL,
  transfer_target_status = NULL,
  transfer_requested_at = NULL;

-- Список проектов группы целиком: только C#-проекты из каталога.
DELETE FROM telegram_group_projects WHERE tg_chat_id = @chat_id;
INSERT INTO telegram_group_projects (tg_chat_id, project_id, added_by_user_id)
SELECT @chat_id, p.id, @owner_id
FROM projects p
WHERE p.workspace_id = @workspace_id
  AND LOWER(TRIM(TRAILING '.git' FROM TRIM(TRAILING '/' FROM p.git_repo_url))) IN (
    'https://github.com/djdes/config',
    'https://github.com/djdes/dirmp3ftp',
    'https://github.com/djdes/filtermusic',
    'https://github.com/djdes/individualservices',
    'https://github.com/djdes/masterwatcher',
    'https://github.com/djdes/planningproduct'
  );

SELECT COUNT(*) AS group_projects FROM telegram_group_projects WHERE tg_chat_id = @chat_id;
-- Ожидается 6. Если меньше — ROLLBACK и проверьте git_repo_url проектов.
COMMIT;
