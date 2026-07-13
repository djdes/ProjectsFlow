// Делегирование одной задачи одному пользователю. См. db/039, db/054.
// Работает для inbox-задач И задач именованных проектов (см. DelegateExistingTask).
// One-to-one: одна активная (accepted) делегация на task. Архивные/declined/
// withdrawn остаются для истории.
//
// creatorUserId/creatorDisplayName = делегатор. Источник — персистентная колонка
// task_delegations.delegator_user_id (db/054); для legacy-NULL строк репозиторий
// фолбэчит на projects.owner_id через COALESCE.
//
// Mirrored: client/src/domain/task/TaskDelegation.ts.

export type TaskDelegationStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'withdrawn'
  | 'archived'
  // Приглашение+делегирование не-участнику проекта (db/101): человек ещё не в проекте,
  // задача ждёт его accept (вступит + примет) или decline (откат ответственного).
  | 'pending_invite';

export const TASK_DELEGATION_STATUSES: readonly TaskDelegationStatus[] = [
  'pending',
  'accepted',
  'declined',
  'withdrawn',
  'archived',
  'pending_invite',
];

// Активная делегация — только accepted: делегирование мгновенное (спека §4), pending/
// pending_invite больше не создаются (см. Task 11); legacy-строки добиты миграцией 112.
export const ACTIVE_DELEGATION_STATUSES: readonly TaskDelegationStatus[] = ['accepted'];

export type TaskDelegation = {
  readonly id: string;
  readonly taskId: string;
  readonly delegateUserId: string;
  readonly delegateDisplayName: string;
  // Фото делегата/создателя (users.avatar_url) — для аватарок в UI. null = нет фото (рисуем
  // инициалы). Optional: старые фикстуры/конструкции без аватаров остаются валидны.
  readonly delegateAvatarUrl?: string | null;
  readonly creatorUserId: string;
  readonly creatorDisplayName: string;
  readonly creatorAvatarUrl?: string | null;
  readonly status: TaskDelegationStatus;
  readonly createdAt: Date;
  readonly respondedAt: Date | null;
  // Кому вернуть ответственность при отказе от вступления (только для pending_invite).
  readonly revertToUserId: string | null;
};
