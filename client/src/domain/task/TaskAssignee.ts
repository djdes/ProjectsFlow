// Единственный текущий ответственный задачи. Mirrors server domain.
export type TaskAssignee = {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
};
