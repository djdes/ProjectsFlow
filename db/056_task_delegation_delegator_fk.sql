-- 056: FK для delegator_user_id (вынесен из db/054, чтобы прогон не клинило).
-- Опциональное упрочнение: строку и так якорит fk_td_user на delegate_user_id.

-- Pre-flight: занулить бэкфилленных владельцев, которых нет в users (у projects.owner_id
-- НЕТ FK, поэтому «висячий» owner возможен и уронил бы ADD FK с errno 1452).
UPDATE task_delegations td
  LEFT JOIN users u ON u.id = td.delegator_user_id
  SET td.delegator_user_id = NULL
  WHERE td.delegator_user_id IS NOT NULL AND u.id IS NULL;

-- ON DELETE SET NULL (не CASCADE): сохраняем историю делегаций, если делегатор удалит
-- аккаунт. При NULL-делегаторе creatorUserId COALESCE'ится на projects.owner_id, поэтому
-- осиротевшую pending-делегацию сможет отозвать владелец проекта (легитимная инстанция).
--
-- Идемпотентность через DROP ... IF EXISTS + ADD (а НЕ «ADD CONSTRAINT IF NOT EXISTS»:
-- такого синтаксиса для FK в MariaDB нет — он валит прогон с ER_PARSE_ERROR). Если
-- предыдущий прогон создал FK, но упал до записи в _migrations — DROP снимет его, ADD
-- пересоздаст. На чистой БД DROP IF EXISTS — no-op.
ALTER TABLE task_delegations
  DROP FOREIGN KEY IF EXISTS fk_td_delegator;
ALTER TABLE task_delegations
  ADD CONSTRAINT fk_td_delegator FOREIGN KEY (delegator_user_id)
    REFERENCES users(id) ON DELETE SET NULL;
