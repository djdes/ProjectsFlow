// Делегирование одной задачи одному пользователю. См. db/039.
// Новые делегации создаются сразу accepted (мгновенное делегирование, спека 2026-07-13);
// pending/declined/pending_invite остались в union только как исторические значения БД.

export type TaskDelegationStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'withdrawn'
  | 'archived'
  // Приглашение+делегирование не-участнику проекта (db/101): ждёт вступления делегата.
  | 'pending_invite';

export type TaskDelegation = {
  readonly id: string;
  readonly taskId: string;
  readonly delegateUserId: string;
  readonly delegateDisplayName: string;
  // Фото делегата/создателя (users.avatar_url). null/undefined = нет фото → рисуем инициалы.
  readonly delegateAvatarUrl?: string | null;
  readonly creatorUserId: string;
  readonly creatorDisplayName: string;
  readonly creatorAvatarUrl?: string | null;
  readonly status: TaskDelegationStatus;
  readonly createdAt: Date;
  readonly respondedAt: Date | null;
};
