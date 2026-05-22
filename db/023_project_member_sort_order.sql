-- db/023_project_member_sort_order.sql
-- Персональный порядок проектов в сайдбаре. Сортировка хранится на membership
-- (project_members), а не на projects: у каждого участника свой порядок, пересортировка
-- одним юзером не влияет на остальных.
-- DEFAULT 0 + вторичная сортировка по projects.created_at сохраняет текущий порядок
-- до первой ручной пересортировки (бэкфилл не требуется).

ALTER TABLE project_members
  ADD COLUMN sort_order INT NOT NULL DEFAULT 0;
