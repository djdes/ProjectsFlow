-- Delegation state «pending_invite»: перетащили задачу на человека, которого нет в
-- проекте → его приглашают в проект И поручают задачу одним действием. До ответа
-- делегация висит в статусе pending_invite (занимает «активный слот» задачи наравне с
-- pending/accepted). Приглашённый принимает → вступает в проект + делегация accepted;
-- отклоняет → делегация declined, ответственный откатывается на revert_to_user_id
-- (прежний исполнитель / перетащивший).
ALTER TABLE task_delegations
  MODIFY COLUMN status ENUM(
    'pending',
    'accepted',
    'declined',
    'withdrawn',
    'archived',
    'pending_invite'
  ) NOT NULL DEFAULT 'pending';

-- Кому вернуть ответственность, если приглашённый отклонит вступление (прежний активный
-- делегат на момент приглашения; NULL — откатывать не к кому, задача вернётся владельцу).
ALTER TABLE task_delegations
  ADD COLUMN revert_to_user_id CHAR(36) NULL AFTER delegator_user_id;

ALTER TABLE task_delegations
  ADD CONSTRAINT fk_td_revert_to FOREIGN KEY (revert_to_user_id)
    REFERENCES users(id) ON DELETE SET NULL;
