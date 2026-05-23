// Единая permissions-матрица для multi-tenant проектов. Use-case'ы вместо разрозненных
// if'ов вызывают can(role, action). См. spec секцию 3.
//
// ВАЖНО: viewer тоже может оставлять комментарии (create_comment + own update/delete) —
// это «read-mostly» роль, но не «strictly read-only». Если понадобится «совсем тихий зритель»
// — введём отдельную роль 'guest' позже, не ломая текущее семантику.

import type { ProjectRole } from './ProjectMembership.js';

export type ProjectAction =
  | 'read_project'
  | 'update_project'
  | 'delete_project'
  | 'create_task'
  | 'update_task'
  | 'delete_task'
  | 'move_task'
  | 'create_comment'
  | 'update_own_comment'
  | 'delete_own_comment'
  | 'delete_any_comment'
  | 'link_commit'
  | 'manage_kb'
  | 'manage_attachments'
  | 'invite_member'
  | 'remove_member'
  | 'transfer_ownership'
  | 'delegate_task_to_agent'
  | 'cancel_agent_job'
  | 'manage_finance'
  | 'set_project_dispatcher';

const REQUIRED_ROLE: Record<ProjectAction, ProjectRole> = {
  read_project: 'viewer',
  update_project: 'editor',
  delete_project: 'owner',
  create_task: 'editor',
  update_task: 'editor',
  delete_task: 'editor',
  move_task: 'editor',
  create_comment: 'viewer',
  update_own_comment: 'viewer',
  delete_own_comment: 'viewer',
  delete_any_comment: 'editor',
  link_commit: 'editor',
  manage_kb: 'editor',
  manage_attachments: 'editor',
  invite_member: 'owner',
  remove_member: 'owner',
  transfer_ownership: 'owner',
  delegate_task_to_agent: 'editor',
  cancel_agent_job: 'editor',
  // Финансы (зарплаты/расходы/доходы) меняет только владелец.
  manage_finance: 'owner',
  // Сменить Ralph-диспетчера может любой участник — это routing automation,
  // не доступ к данным. Admin-bypass позволяет админу менять диспетчера в любом
  // проекте (даже где он не member) — используется в admin-панели.
  set_project_dispatcher: 'viewer',
};

const ROLE_LEVEL: Record<ProjectRole, number> = { viewer: 0, editor: 1, owner: 2 };

export function can(actorRole: ProjectRole, action: ProjectAction): boolean {
  return ROLE_LEVEL[actorRole] >= ROLE_LEVEL[REQUIRED_ROLE[action]];
}

export function requiredRoleFor(action: ProjectAction): ProjectRole {
  return REQUIRED_ROLE[action];
}
