-- 008: «Входящие» — phantom-project per user для задач без привязки к конкретному проекту.
-- Просто флаг is_inbox=true на одном из проектов юзера; вся task-инфра работает без изменений.
-- Inbox-проект создаётся лениво через GetOrCreateInbox use-case при первом обращении.

ALTER TABLE projects
  ADD COLUMN is_inbox BOOLEAN NOT NULL DEFAULT FALSE;

-- Индекс под lookup'ы вида "найди inbox юзера" — selectivity нормальная (≤1 inbox на owner_id).
CREATE INDEX idx_projects_owner_inbox ON projects (owner_id, is_inbox);
