-- Расширение делегации GitHub-токена с «one row per project» (granter всегда =
-- owner) до per-member opt-in. Каждый участник проекта независимо разрешает
-- свою делегацию. При запросе сервер идёт по кандидатам в порядке:
--   1. owner (если у него enabled + github)
--   2. остальные members, сорт. по displayName ASC (case-insensitive)
-- Caller (диспетчер) исключается — сам себе токен не отдаёт.
--
-- Структурные изменения:
--   - PRIMARY KEY: (project_id) → (project_id, granter_user_id)
--   - В access-log ENUM добавляется outcome 'no_eligible_grantor'

-- Новая таблица с правильным составным PK.
CREATE TABLE project_git_token_delegations_v2 (
  project_id CHAR(36) NOT NULL,
  granter_user_id CHAR(36) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  granted_at TIMESTAMP NULL DEFAULT NULL,
  revoked_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, granter_user_id),
  -- MariaDB не поддерживает partial-index'ы — простой полный индекс.
  INDEX idx_pgtd_project (project_id),
  INDEX idx_pgtd_granter (granter_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Перенос существующих v0.14 данных (одна запись на проект — granter = owner
-- на момент включения). В новую модель попадают as-is: project_id+granter_user_id
-- уникальны (в старой таблице project_id и так был PK).
INSERT INTO project_git_token_delegations_v2
  (project_id, granter_user_id, enabled, granted_at, revoked_at, created_at, updated_at)
SELECT project_id, granter_user_id, enabled, granted_at, revoked_at, created_at, updated_at
FROM project_git_token_delegations;

-- Подмена таблиц. DDL в MariaDB auto-commit'ится — между DROP и RENAME окно <100ms.
-- CI деплоит с migrate-перед-pm2-reload, поэтому app не работает в этом окне.
DROP TABLE project_git_token_delegations;
RENAME TABLE project_git_token_delegations_v2 TO project_git_token_delegations;

-- Добавить новый outcome в access-log. В MariaDB ENUM меняется через MODIFY COLUMN.
ALTER TABLE project_git_token_access_log
  MODIFY COLUMN outcome ENUM(
    'ok',
    'not_dispatcher',
    'delegation_disabled',
    'granter_github_disconnected',
    'granter_not_owner_anymore',
    'no_eligible_grantor'
  ) NOT NULL;
