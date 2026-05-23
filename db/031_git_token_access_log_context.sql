-- Добавить колонку `context` в access-log делегаций. Спека просит «outcome_extra»
-- для типизации «для чего брали токен»:
--   'git_token_fetch'  — endpoint /agent/.../git-token (исходный)
--   'link_commit'      — внутренний вызов из LinkCommit use-case'а
--   'sync_commits'     — из SyncTaskCommits
--   'kb_write'         — из GithubKbBackend.write через WriteKbDocument
-- Старые записи (до этой миграции) останутся с NULL — это «legacy git_token_fetch».

ALTER TABLE project_git_token_access_log
  ADD COLUMN context VARCHAR(50) NULL DEFAULT NULL AFTER outcome;
