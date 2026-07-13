-- 110: роли участников пространства: ENUM('owner','member') → ENUM('owner','editor','viewer').
-- Существующие member → editor. Через промежуточный расширенный ENUM — MariaDB не умеет
-- переименовать значение ENUM за один шаг без потери данных (сужение при живых 'member'
-- в strict mode упало бы). Идемпотентно при повторном прогоне после частичного сбоя.
-- См. docs/superpowers/specs/2026-07-13-unified-workspace-and-instant-delegation-design.md §3.1.

ALTER TABLE workspace_members
  MODIFY COLUMN role ENUM('owner','member','editor','viewer') NOT NULL DEFAULT 'member';

UPDATE workspace_members SET role = 'editor' WHERE role = 'member';

ALTER TABLE workspace_members
  MODIFY COLUMN role ENUM('owner','editor','viewer') NOT NULL DEFAULT 'editor';
