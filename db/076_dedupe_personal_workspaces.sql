-- 076: один воркспейс по умолчанию на пользователя + переименование в «Пространство <имя>».
--
-- Контекст: при многократном (ручном) прогоне backfill'а db/073 у пользователей могло
-- появиться несколько пространств; плюс ранняя версия этой миграции ссылалась на временную
-- таблицу _canon дважды в одном INSERT (`... WHERE owner_user_id NOT IN (SELECT FROM _canon)`),
-- из-за чего падала с MariaDB-ошибкой 1137 «Can't reopen table» и блокировала весь прогон.
--
-- Эта версия: для каждого владельца оставляет ОДИН каноничный воркспейс (текущий активный,
-- если он принадлежит владельцу; иначе самый старый), переносит в него все проекты, чат и
-- участников остальных принадлежащих ему воркспейсов, лишние удаляет, и переименовывает
-- оставшийся в «Пространство <display_name>». Канонический выбор — одним проходом через
-- GROUP_CONCAT (без повторной ссылки на временную таблицу). Идемпотентно: повторный прогон
-- лишь подтверждает имя.

DROP TEMPORARY TABLE IF EXISTS _ws_src;
DROP TEMPORARY TABLE IF EXISTS _canon;
DROP TEMPORARY TABLE IF EXISTS _ws_map;

-- Строки-источники: для каждого воркспейса — его владелец, дата и активный воркспейс владельца.
CREATE TEMPORARY TABLE _ws_src AS
SELECT w.id, w.owner_user_id, w.created_at,
       (SELECT u.current_workspace_id FROM users u WHERE u.id = w.owner_user_id) AS cur_ws
  FROM workspaces w;

-- Каноничный воркспейс на владельца: активный (если принадлежит ему), иначе самый старый.
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

-- Переносим проекты.
UPDATE projects p JOIN _ws_map m ON p.workspace_id = m.dup_id
   SET p.workspace_id = m.canonical_id;

-- Переносим сообщения чата (реакции/вложения висят на message_id — не трогаем).
UPDATE workspace_chat_messages cm JOIN _ws_map m ON cm.workspace_id = m.dup_id
   SET cm.workspace_id = m.canonical_id;

-- Курсоры прочитанного лишних — отбрасываем (PK (workspace_id,user_id) мог бы конфликтовать).
DELETE r FROM workspace_chat_reads r JOIN _ws_map m ON r.workspace_id = m.dup_id;

-- Участники лишних → в каноничный (без дублей; роль каноничного приоритетнее).
INSERT IGNORE INTO workspace_members (workspace_id, user_id, role)
SELECT m.canonical_id, wm.user_id, wm.role
  FROM workspace_members wm JOIN _ws_map m ON wm.workspace_id = m.dup_id;

-- Кто смотрел на лишнее → на каноничный.
UPDATE users u JOIN _ws_map m ON u.current_workspace_id = m.dup_id
   SET u.current_workspace_id = m.canonical_id;

-- Удаляем лишние (workspace_members/чат-строки уйдут по ON DELETE CASCADE).
DELETE w FROM workspaces w JOIN _ws_map m ON w.id = m.dup_id;

-- Переименовываем каноничный в «Пространство <display_name>».
UPDATE workspaces w
  JOIN _canon c ON c.canonical_id = w.id
  JOIN users  u ON u.id = w.owner_user_id
   SET w.name = CONCAT('Пространство ', u.display_name);

-- Гарантируем, что активное пространство владельца = каноничный.
UPDATE users u JOIN _canon c ON c.owner_user_id = u.id
   SET u.current_workspace_id = c.canonical_id;

DROP TEMPORARY TABLE IF EXISTS _ws_src;
DROP TEMPORARY TABLE IF EXISTS _canon;
DROP TEMPORARY TABLE IF EXISTS _ws_map;
