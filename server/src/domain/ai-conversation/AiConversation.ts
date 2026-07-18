export type AiConversationKind = 'personal' | 'project_studio';

export type AiConversation = {
  readonly id: string;
  readonly ownerUserId: string;
  readonly workspaceId: string | null;
  readonly projectId: string | null;
  readonly kind: AiConversationKind;
  readonly title: string;
  readonly version: number;
  readonly lastMessageSeq: number | null;
  readonly lastMessageAt: Date | null;
  readonly archivedAt: Date | null;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export const DEFAULT_AI_CONVERSATION_TITLE = 'Новый чат';
