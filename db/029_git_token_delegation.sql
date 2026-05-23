-- Делегирование GitHub OAuth-токена владельца проекта Ralph-диспетчеру.
--
-- Мотивация: на совместных проектах диспетчером может быть один юзер (admin),
-- а GitHub-подключение — у другого (владельца репо). Сейчас у диспетчера нет
-- легального способа взять GitHub-токен владельца — без него Ralph не может
-- пушить ветки и открывать PR от имени owner'а.
--
-- Opt-in: owner на сайте включает toggle. Снимается одним кликом. Токен НЕ
-- копируется в таблицу делегации — она хранит только «owner X разрешил
-- использовать СВОЙ live-токен дежурному диспетчеру проекта». При запросе
-- сервер берёт текущий `user_github_tokens.access_token` granter'а в момент
-- вызова — рефрэш OAuth подхватывается автоматически.
--
-- FK CASCADE в проекте не используются (см. db/*.sql) — ручной cascade-cleanup
-- при удалении проекта/юзера делает DeleteProject use-case. Сюда добавлено
-- delete делегации и access-log'а в его транзакции.

CREATE TABLE project_git_token_delegations (
  project_id CHAR(36) NOT NULL PRIMARY KEY,
  granter_user_id CHAR(36) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  granted_at TIMESTAMP NULL DEFAULT NULL,
  revoked_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pgtd_granter (granter_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE project_git_token_access_log (
  id CHAR(36) NOT NULL PRIMARY KEY,
  project_id CHAR(36) NOT NULL,
  accessed_by_user_id CHAR(36) NOT NULL,
  -- nullable: при `not_dispatcher` или `delegation_disabled` мы можем не знать granter'а
  -- (или знаем только из делегации, которой нет).
  granter_user_id CHAR(36) NULL,
  outcome ENUM(
    'ok',
    'not_dispatcher',
    'delegation_disabled',
    'granter_github_disconnected',
    'granter_not_owner_anymore'
  ) NOT NULL,
  accessed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pgtal_project_time (project_id, accessed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
