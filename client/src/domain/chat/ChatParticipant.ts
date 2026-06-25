// Участник чат-комнаты пространства (view-тип для поповера состава). Это все люди
// пространства (join workspace_members ↔ users), email — внутренний инструмент, показываем.
export type ChatParticipant = {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly avatarUrl: string | null;
};
