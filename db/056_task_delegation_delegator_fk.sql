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
-- IF NOT EXISTS — чтобы повторный прогон файла (если runner упал между ALTER и записью
-- в _migrations) не падал с errno 1826 «Duplicate foreign key constraint name».
ALTER TABLE task_delegations
  ADD CONSTRAINT IF NOT EXISTS fk_td_delegator FOREIGN KEY (delegator_user_id)
    REFERENCES users(id) ON DELETE SET NULL;
