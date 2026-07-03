export type WorkspaceRole = 'owner' | 'member';

// 'default' — личный хаб (все мои проекты + общий чат, неудаляем, один на юзера);
// 'team' — созданное вручную командное пространство.
export type WorkspaceKind = 'default' | 'team';

// Пространство (workspace): верхнеуровневый изолированный контейнер над проектами.
export type Workspace = {
  readonly id: string;
  readonly name: string;
  // Эмодзи-иконка; null = дефолт (первая буква названия).
  readonly icon: string | null;
  readonly kind: WorkspaceKind;
  readonly ownerUserId: string;
  // Роль текущего юзера в пространстве.
  readonly role: WorkspaceRole;
  // Число проектов в пространстве (read-model для UI). Для дефолт-хаба — все проекты юзера.
  readonly projectCount: number;
  // Число участников пространства (read-model для UI).
  readonly memberCount: number;
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
