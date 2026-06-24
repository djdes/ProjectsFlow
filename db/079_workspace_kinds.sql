-- 079: тип пространства (kind) + личный «дефолт-хаб со всеми моими проектами».
--
-- Модель после этой миграции:
--  • У каждого владельца ровно одно пространство kind='default' — его «хаб». В нём он видит
--    ВСЕ свои проекты (агрегат по участию, см. ListProjects), а участники хаба = владелец +
--    все, с кем у него есть общие проекты (это и есть участники общего чата).
--  • Любое созданное вручную пространство — kind='team' (свои участники, свой чат).
--  • Чужие дефолт-хабы в свитчере не показываются (фильтр на сервере, listForUser).
--
-- Идемпотентно. MariaDB-совместимо (temp-таблица как в db/077, без повторной ссылки на неё
-- в одном стейтменте → без ошибки 1137).

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS kind ENUM('default','team') NOT NULL DEFAULT 'team';

-- Каноничный хаб на владельца: его активный воркспейс (если принадлежит ему), иначе старейший
-- принадлежащий. Тот же выбор, что в db/077 → метим именно консолидированное пространство.
DROP TEMPORARY TABLE IF EXISTS _hub_pick;
CREATE TEMPORARY TABLE _hub_pick AS
SELECT w.owner_user_id,
       COALESCE(
         MAX(CASE WHEN w.id = u.current_workspace_id THEN w.id END),
         SUBSTRING_INDEX(GROUP_CONCAT(w.id ORDER BY w.created_at ASC, w.id ASC), ',', 1)
       ) AS hub_id
  FROM workspaces w
  JOIN users u ON u.id = w.owner_user_id
 GROUP BY w.owner_user_id;

UPDATE workspaces w JOIN _hub_pick h ON h.hub_id = w.id SET w.kind = 'default';
DROP TEMPORARY TABLE IF EXISTS _hub_pick;

-- Членство хаба = владелец + все участники его проектов (пересобираем, как db/073, но только
-- в дефолт владельца). INSERT IGNORE — идемпотентно.
INSERT IGNORE INTO workspace_members (workspace_id, user_id, role)
SELECT w.id, w.owner_user_id, 'owner'
  FROM workspaces w
 WHERE w.kind = 'default';

INSERT IGNORE INTO workspace_members (workspace_id, user_id, role)
SELECT w.id, pm.user_id, 'member'
  FROM workspaces w
  JOIN projects p        ON p.owner_id = w.owner_user_id
  JOIN project_members pm ON pm.project_id = p.id
 WHERE w.kind = 'default'
   AND pm.user_id <> w.owner_user_id;

-- Прунинг: из дефолт-хаба убрать тех, кто не владелец и не участвует ни в одном проекте
-- владельца (осиротевшие после консолидации db/077). Держит участников чата = точно
-- «все, с кем есть общий проект».
DELETE wm FROM workspace_members wm
  JOIN workspaces w ON w.id = wm.workspace_id AND w.kind = 'default'
 WHERE wm.user_id <> w.owner_user_id
   AND NOT EXISTS (
     SELECT 1 FROM project_members pm
       JOIN projects p ON p.id = pm.project_id
      WHERE p.owner_id = w.owner_user_id AND pm.user_id = wm.user_id
   );

-- Чат начать заново (Q4): текущие сообщения — тестовый спам. Удаляем child-first (FK-safe;
-- TRUNCATE нельзя — таблицы под FK). Бинарь-вложения в сторадже осиротеют — некритично.
DELETE FROM workspace_chat_attachments;
DELETE FROM workspace_chat_reactions;
DELETE FROM workspace_chat_reads;
DELETE FROM workspace_chat_messages;
