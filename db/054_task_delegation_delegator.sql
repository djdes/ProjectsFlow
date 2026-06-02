-- 054: кто делегировал задачу (delegator_user_id). Раньше делегатор выводился из
-- projects.owner_id — неверно, как только не-владелец именованного проекта делегирует
-- задачу. Добавляем явную колонку + бэкфилл. См. план «Поручено мне».
--
-- FK вынесен в отдельный db/056 (раннер scripts/migrate.mjs гоняет без транзакции —
-- частичный сбой не должен заклинить прогон на «Duplicate column»/orphan-FK).

ALTER TABLE task_delegations
  ADD COLUMN IF NOT EXISTS delegator_user_id CHAR(36) NULL AFTER delegate_user_id;

-- Бэкфилл: до этой миграции делегатором ВСЕГДА был владелец проекта задачи.
-- БЕЗ предиката is_inbox: строка делегации может «ехать» на задаче, позже перенесённой
-- в именованный проект через AssignInboxTaskToProject (делегация архивируется, но строка
-- остаётся). Гейт на is_inbox=1 оставил бы такие строки NULL навсегда.
-- Guard IS NULL => безопасный повторный прогон.
UPDATE task_delegations td
  JOIN tasks t    ON t.id = td.task_id
  JOIN projects p ON p.id = t.project_id
  SET td.delegator_user_id = p.owner_id
  WHERE td.delegator_user_id IS NULL;

-- Поддержка будущих выборок «делегации, отправленные мной».
ALTER TABLE task_delegations
  ADD INDEX IF NOT EXISTS idx_delegator_status (delegator_user_id, status);
