// Тип актора-автора комментария. См. spec comment-actor-kind.md.
//   'user'   — реальный человек через session/cookie endpoint.
//   'agent'  — автомат через /agent/* bearer agent-token (Ralph-диспетчер/воркер).
//   'system' — внутренние авто-действия сервера (миграции, авто-уведомления). Пока не используется.
export type TaskCommentActorKind = 'user' | 'agent' | 'system';

// Известные agent-name (расширяемо строкой — для будущих агентов без миграции).
// UI маппит на читаемый title. NULL для actorKind != 'agent'.
export type KnownAgentName =
  | 'ralph-dispatcher'
  | 'ralph-worker'
  | 'ralph-grillme'
  | 'ralph-verify';

export type TaskComment = {
  readonly id: string;
  readonly taskId: string;
  readonly ownerUserId: string;
  readonly body: string;
  readonly actorKind: TaskCommentActorKind;
  readonly agentName: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
