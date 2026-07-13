-- 112: бэкфилл единого членства + мгновенное делегирование.
-- 1) Участники не-inbox проектов становятся участниками ПРОСТРАНСТВ этих проектов —
--    workspace_members отныне единственный источник доступа (спека §3.1/§3.2).
--    INSERT IGNORE: существующие членства (включая owner'ов пространств) НЕ трогаются
--    и НЕ понижаются; повторный прогон после частичного сбоя безопасен.
-- 2) Все ждущие делегации (pending / pending_invite) становятся принятыми — accept/decline
--    флоу выпилен (спека §4). ENUM статусов НЕ сужаем: старые значения остаются историей.
-- См. docs/superpowers/specs/2026-07-13-unified-workspace-and-instant-delegation-design.md §7.

-- Владельцы пространств: гарантируем owner-членство до основного бэкфилла
-- (идемпотентно, паттерн db/073/db/079) — «последний owner» не может быть понижен,
-- т.к. INSERT IGNORE не перезаписывает существующую строку.
INSERT IGNORE INTO workspace_members (workspace_id, user_id, role)
SELECT w.id, w.owner_user_id, 'owner'
  FROM workspaces w;

-- Участник любого не-inbox проекта P → участник пространства P. Роль — высшая из его
-- проектных ролей в проектах этого пространства: owner/editor проекта → editor
-- пространства (owner проекта, не являющийся owner_user_id пространства, получает
-- editor — спека §7.3), только viewer'ские роли → viewer.
-- pm.role IN ('owner','editor') — булево 1/0, MAX по группе = «есть хоть одна ≥ editor».
INSERT IGNORE INTO workspace_members (workspace_id, user_id, role)
SELECT p.workspace_id,
       pm.user_id,
       CASE WHEN MAX(pm.role IN ('owner','editor')) = 1 THEN 'editor' ELSE 'viewer' END
  FROM project_members pm
  JOIN projects p ON p.id = pm.project_id
 WHERE p.is_inbox = 0
 GROUP BY p.workspace_id, pm.user_id;

-- Делегирование без принятия: всё «ждущее ответа» считается принятым.
-- responded_at присваивается ДО status (SET исполняется слева направо) и только там,
-- где его ещё не было.
UPDATE task_delegations
   SET responded_at = COALESCE(responded_at, NOW()),
       status = 'accepted'
 WHERE status IN ('pending','pending_invite');
