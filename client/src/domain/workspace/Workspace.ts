export type WorkspaceRole = 'owner' | 'member';

// Пространство (workspace): верхнеуровневый изолированный контейнер над проектами.
export type Workspace = {
  readonly id: string;
  readonly name: string;
  // Эмодзи-иконка; null = дефолт (первая буква названия).
  readonly icon: string | null;
  readonly ownerUserId: string;
  // Роль текущего юзера в пространстве.
  readonly role: WorkspaceRole;
  // Число проектов в пространстве (read-model для UI).
  readonly projectCount: number;
  // Активное ли это пространство у текущего юзера (источник правды — сервер).
  readonly isCurrent: boolean;
  readonly createdAt: Date;
};

// Участник пространства (для страницы настроек).
export type WorkspaceMember = {
  readonly userId: string;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly avatarUrl: string | null;
  readonly role: WorkspaceRole;
};
