-- db/082_deploy_method_auto.sql
-- Добавляет 4-й вариант деплоя 'auto' в project_automation.deploy_method.
-- 'auto' = воркер деплоит сам, как описано в CLAUDE.md проекта (без указания команды).
-- Остальные значения и дефолт ('github_auto') сохраняются. Append-only: MODIFY enum.

ALTER TABLE project_automation
  MODIFY COLUMN deploy_method ENUM('github_auto','ssh_manual','none','auto')
    NOT NULL DEFAULT 'github_auto';
