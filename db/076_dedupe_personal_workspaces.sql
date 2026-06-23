-- 076: схлопывание дублей личных пространств «Личное».
-- В дев-БД backfill из db/073 мог быть прогнан несколько раз вручную (в проде _migrations
-- гарантирует один прогон), из-за чего у владельца появилось несколько одинаковых «Личное».
-- Эта миграция для каждого такого владельца оставляет одно каноничное пространство (его
-- активное, если оно из дублей; иначе самое старое) и переносит туда проекты, чат и
-- участников остальных, после чего лишние удаляет. Идемпотентно: если дублей нет — no-op.

DROP TEMPORARY TABLE IF EXISTS _dup_owners;
DROP TEMPORARY TABLE IF EXISTS _canon;
DROP TEMPORARY TABLE IF EXISTS _ws_map;

-- Владельцы с >1 «Личное».
CREATE TEMPORARY TABLE _dup_owners AS
SELECT owner_user_id
  FROM workspaces
 WHERE name = 'Личное'
 GROUP BY owner_user_id
HAVING COUNT(*) > 1;

-- Каноничное пространство на владельца.
CREATE TEMPORARY TABLE _canon (
  owner_user_id CHAR(36) NOT NULL PRIMARY KEY,
  canonical_id  CHAR(36) NOT NULL
) ENGINE=InnoDB;

-- 1) Предпочитаем активное пространство, если оно входит в дубли «Личное».
INSERT INTO _canon (owner_user_id, canonical_id)
SELECT o.owner_user_id, u.current_workspace_id
  FROM _dup_owners o
  JOIN users u ON u.id = o.owner_user_id
  JOIN workspaces w
    ON w.id = u.current_workspace_id
   AND w.owner_user_id = o.owner_user_id
   AND w.name = 'Личное';

-- 2) Для остальных — самое старое «Личное».
INSERT INTO _canon (owner_user_id, canonical_id)
SELECT o.owner_user_id,
       (SELECT w.id
          FROM workspaces w
         WHERE w.owner_user_id = o.owner_user_id AND w.name = 'Личное'
         ORDER BY w.created_at ASC, w.id ASC
         LIMIT 1)
  FROM _dup_owners o
 WHERE o.owner_user_id NOT IN (SELECT owner_user_id FROM _canon);

-- Маппинг лишних → каноничное.
CREATE TEMPORARY TABLE _ws_map AS
SELECT w.id AS dup_id, c.canonical_id
  FROM workspaces w
  JOIN _canon c ON c.owner_user_id = w.owner_user_id
 WHERE w.name = 'Личное' AND w.id <> c.canonical_id;

-- Переносим проекты.
UPDATE projects p JOIN _ws_map m ON p.workspace_id = m.dup_id
   SET p.workspace_id = m.canonical_id;

-- Переносим сообщения чата (реакции/вложения висят на message_id — не трогаем).
UPDATE workspace_chat_messages cm JOIN _ws_map m ON cm.workspace_id = m.dup_id
   SET cm.workspace_id = m.canonical_id;

-- Курсоры прочитанного лишних — отбрасываем (PK (workspace_id,user_id) мог бы конфликтовать).
DELETE r FROM workspace_chat_reads r JOIN _ws_map m ON r.workspace_id = m.dup_id;

-- Участники лишних → в каноничное (без дублей; роль каноничного приоритетнее).
INSERT IGNORE INTO workspace_members (workspace_id, user_id, role)
SELECT m.canonical_id, wm.user_id, wm.role
  FROM workspace_members wm JOIN _ws_map m ON wm.workspace_id = m.dup_id;

-- Активное пространство тех, кто смотрел на лишнее → каноничное.
UPDATE users u JOIN _ws_map m ON u.current_workspace_id = m.dup_id
   SET u.current_workspace_id = m.canonical_id;

-- Удаляем лишние (workspace_members/чат-строки уйдут по ON DELETE CASCADE).
DELETE w FROM workspaces w JOIN _ws_map m ON w.id = m.dup_id;

DROP TEMPORARY TABLE IF EXISTS _dup_owners;
DROP TEMPORARY TABLE IF EXISTS _canon;
DROP TEMPORARY TABLE IF EXISTS _ws_map;
