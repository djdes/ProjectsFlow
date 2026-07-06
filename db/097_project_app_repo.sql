-- db/097 — GitHub-репо приложения проекта (self-serve воркер-раннер, M1).
-- app_repo_full_name — "owner/repo" на GitHub, куда воркер (GitHub Actions) пишет код проекта
--                      и откуда билдится статический результат. Создаётся один раз при первой
--                      привязке GitHub (EnsureProjectAppRepo, под аккаунтом владельца проекта).
--                      NULL = ещё не создан. Отдельно от kb_repo_full_name (это код, а не БЗ).
--                      См. spec 2026-07-06-self-serve-worker-runner-and-deploy-design.md.
ALTER TABLE projects
  ADD COLUMN app_repo_full_name VARCHAR(255) NULL AFTER published_at;
