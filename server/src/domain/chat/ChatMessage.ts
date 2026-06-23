// Сообщение общего чата пространства. seq — глобально-монотонный курсор (db/075).
// Удаление мягкое: deletedAt != null → tombstone (тело очищается на чтении).
export type ChatMessage = {
  readonly id: string;
  readonly seq: number;
  readonly workspaceId: string;
  readonly authorUserId: string;
  readonly body: string;
  readonly replyToId: string | null;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
  readonly deletedAt: Date | null;
};

// Сообщение, обогащённое автором (join с users) — то, что отдаёт репозиторий.
export type ChatMessageRecord = ChatMessage & {
  readonly authorDisplayName: string;
  readonly authorAvatarUrl: string | null;
};
