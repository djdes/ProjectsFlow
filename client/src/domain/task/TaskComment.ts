import type { TaskAttachment } from './TaskAttachment';

// Кто оставил коммент. 'user' — реальный человек через web-UI; 'agent' — автомат
// через MCP/agent-токен (Ralph-диспетчер и Co); 'system' — внутреннее (пока не
// используется). См. spec C:/www/ralph/prompts/comment-actor-kind.md.
export type TaskCommentActorKind = 'user' | 'agent' | 'system';

// Известные agent-имена. Список расширяемо строкой — старые UI-сборки не должны
// падать на новых именах, просто покажут generic 'Агент · {name}'.
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
  readonly createdAt: Date;
  readonly updatedAt: Date;
  // Тип актора. На старых backend'ах поле может отсутствовать — fallback 'user'
  // мы делаем на маппинге в HttpTaskRepository.
  readonly actorKind: TaskCommentActorKind;
  // Конкретный agent (для UI-title). NULL если actorKind != 'agent'.
  readonly agentName: string | null;
  // Вложения комментария (на list-эндпоинте). На create — пусто (грузятся отдельно).
  readonly attachments: TaskAttachment[];
};
