// Клиентские типы общего чата пространства (зеркало server ChatMessageView).

export type ChatReactionAggregate = {
  readonly emoji: string;
  readonly count: number;
  readonly userIds: readonly string[];
};

export type ChatAttachment = {
  readonly id: string;
  readonly messageId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly width: number | null;
  readonly height: number | null;
  // Готовый URL бинаря (auth-gated endpoint) — для <img src> / ссылки-скачивания.
  readonly url: string;
};

export type ChatReplyPreview = {
  readonly id: string;
  readonly authorDisplayName: string;
  readonly excerpt: string;
  readonly deleted: boolean;
};

export type ChatMessage = {
  readonly id: string;
  readonly seq: number;
  readonly workspaceId: string;
  readonly authorUserId: string;
  readonly authorDisplayName: string;
  readonly authorAvatarUrl: string | null;
  readonly body: string;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
  readonly deleted: boolean;
  readonly replyTo: ChatReplyPreview | null;
  readonly reactions: readonly ChatReactionAggregate[];
  readonly attachments: readonly ChatAttachment[];
};
