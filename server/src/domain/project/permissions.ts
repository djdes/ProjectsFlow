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
  | 'delegate_task'
  | 'manage_kb'
  | 'manage_attachments'
  | 'invite_member'
  | 'remove_member'
  | 'transfer_ownership'
  | 'delegate_task_to_agent'
  | 'cancel_agent_job'
  | 'manage_finance'
  | 'set_project_dispatcher'
  | 'set_git_token_delegation'
  // file-sync: пуш/ack снепшотов и управление workspace со стороны клиента-владельца.
  | 'manage_file_sync'
  // Мониторинг серверов: просмотр метрик/логов/алертов и управление серверами.
  // Owner-only (чувствительные ops-данные, как финансы). См. spec server-monitoring-design.md.
  | 'view_monitoring'
  | 'manage_monitoring';

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
  // Поручить задачу другому участнику проекта (человеку). Отдельно от
  // delegate_task_to_agent (роутинг на Ralph) и move_task — чтобы правки одного
  // не меняли молча другое. Делегатор — editor+; делегат тоже должен быть editor+
  // (иначе примет, но не сможет двигать/выполнять). См. DelegateExistingTask.
  delegate_task: 'editor',
  manage_kb: 'editor',
  manage_attachments: 'editor',
  // Приглашать новых участников может editor (и owner): помогает командам с горизонтальной
  // структурой расти, не дёргая владельца. Owner-only остаётся для remove_member и
  // transfer_ownership (структурные изменения команды).
  invite_member: 'editor',
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
  // Включить/выключить делегацию GitHub-токена. Owner-only (доступ к личному OAuth).
  // Admin может через admin-bypass — НО granter остаётся = project.ownerId
  // (admin делегирует НЕ свой токен; см. SetGitTokenDelegation use-case).
  set_git_token_delegation: 'owner',
  // file-sync: клиент-владелец пушит снепшоты / делает ack (editor+). Байтовые операции
  // СО СТОРОНЫ ДИСПЕТЧЕРА гейтятся отдельно через requireDispatcherAccess (не ролью).
  manage_file_sync: 'editor',
  // Мониторинг — owner-only: логи/метрики сервера = чувствительные данные (как финансы).
  view_monitoring: 'owner',
  manage_monitoring: 'owner',
};

const ROLE_LEVEL: Record<ProjectRole, number> = { viewer: 0, editor: 1, owner: 2 };

export function can(actorRole: ProjectRole, action: ProjectAction): boolean {
  return ROLE_LEVEL[actorRole] >= ROLE_LEVEL[REQUIRED_ROLE[action]];
}

export function requiredRoleFor(action: ProjectAction): ProjectRole {
  return REQUIRED_ROLE[action];
}
