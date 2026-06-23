import type { ChatReactionAggregate } from './ChatReaction.js';
import type { ChatAttachment } from './ChatAttachment.js';

// Превью сообщения, на которое отвечают (reply). excerpt — короткая выжимка тела.
export type ChatReplyPreview = {
  readonly id: string;
  readonly authorDisplayName: string;
  readonly excerpt: string;
  readonly deleted: boolean;
};

// Wire-ready read-модель сообщения: то, что уходит в REST-список и в SSE-события.
// Даты — ISO-строки (готовы к JSON). Тело удалённого сообщения очищено (tombstone).
export type ChatMessageView = {
  readonly id: string;
  readonly seq: number;
  readonly workspaceId: string;
  readonly authorUserId: string;
  readonly authorDisplayName: string;
  readonly authorAvatarUrl: string | null;
  readonly body: string;
  readonly createdAt: string;
  readonly editedAt: string | null;
  readonly deleted: boolean;
  readonly replyTo: ChatReplyPreview | null;
  readonly reactions: readonly ChatReactionAggregate[];
  readonly attachments: readonly ChatAttachment[];
};
