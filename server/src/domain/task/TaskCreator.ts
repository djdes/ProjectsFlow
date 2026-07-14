// Автор задачи. Это историческая атрибуция, а не роль владельца и не ответственный.
export type TaskCreator = {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
};
