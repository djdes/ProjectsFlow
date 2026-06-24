-- 077: один воркспейс на пользователя + переименование в «Пространство <имя>».
--
-- db/076 на проде уже помечена применённой (отработала как no-op, т.к. дублей «Личное» не
-- было), поэтому её исправленная логика не выполнится — выносим консолидацию сюда.
--
-- Для каждого ВЛАДЕЛЬЦА оставляем один каноничный воркспейс (его активный, если он
-- принадлежит ему; иначе самый старый), переносим в него проекты/чат/участников остальных
-- ПРИНАДЛЕЖАЩИХ ему воркспейсов, лишние удаляем, оставшийся переименовываем в
-- «Пространство <display_name>». Канонический выбор — одним проходом через GROUP_CONCAT
-- (без повторной ссылки на временную таблицу → без MariaDB-ошибки 1137). Идемпотентно.

DROP TEMPORARY TABLE IF EXISTS _ws_src;
DROP TEMPORARY TABLE IF EXISTS _canon;
DROP TEMPORARY TABLE IF EXISTS _ws_map;

-- Источник: каждый воркспейс + его владелец + активный воркспейс владельца.
CREATE TEMPORARY TABLE _ws_src AS
SELECT w.id, w.owner_user_id, w.created_at,
       (SELECT u.current_workspace_id FROM users u WHERE u.id = w.owner_user_id) AS cur_ws
  FROM workspaces w;

-- Каноничный на владельца: активный (если принадлежит ему), иначе самый старый.
CREATE TEMPORARY TABLE _canon AS
SELECT owner_user_id,
       COALESCE(
         MAX(CASE WHEN id = cur_ws THEN id END),
         SUBSTRING_INDEX(GROUP_CONCAT(id ORDER BY created_at ASC, id ASC), ',', 1)
       ) AS canonical_id
  FROM _ws_src
 GROUP BY owner_user_id;

-- Лишние (не каноничные) воркспейсы владельца → каноничный.
CREATE TEMPORARY TABLE _ws_map AS
SELECT w.id AS dup_id, c.canonical_id
  FROM workspaces w
  JOIN _canon c ON c.owner_user_id = w.owner_user_id
 WHERE w.id <> c.canonical_id;

UPDATE projects p JOIN _ws_map m ON p.workspace_id = m.dup_id
   SET p.workspace_id = m.canonical_id;

UPDATE workspace_chat_messages cm JOIN _ws_map m ON cm.workspace_id = m.dup_id
   SET cm.workspace_id = m.canonical_id;

DELETE r FROM workspace_chat_reads r JOIN _ws_map m ON r.workspace_id = m.dup_id;

INSERT IGNORE INTO workspace_members (workspace_id, user_id, role)
SELECT m.canonical_id, wm.user_id, wm.role
  FROM workspace_members wm JOIN _ws_map m ON wm.workspace_id = m.dup_id;

UPDATE users u JOIN _ws_map m ON u.current_workspace_id = m.dup_id
   SET u.current_workspace_id = m.canonical_id;

DELETE w FROM workspaces w JOIN _ws_map m ON w.id = m.dup_id;

-- Переименовываем каноничный в «Пространство <display_name>».
UPDATE workspaces w
  JOIN _canon c ON c.canonical_id = w.id
  JOIN users  u ON u.id = w.owner_user_id
   SET w.name = CONCAT('Пространство ', u.display_name);

-- Активное пространство владельца = каноничный.
UPDATE users u JOIN _canon c ON c.owner_user_id = u.id
   SET u.current_workspace_id = c.canonical_id;

DROP TEMPORARY TABLE IF EXISTS _ws_src;
DROP TEMPORARY TABLE IF EXISTS _canon;
DROP TEMPORARY TABLE IF EXISTS _ws_map;
