export type User = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  // Системный admin/root: глобальный доступ ко всем проектам + раздел управления.
  readonly isAdmin: boolean;
  readonly createdAt: Date;
};

// Internal type, не утекает за пределы infrastructure/application.
// passwordHash хранится в БД и сравнивается на login; в domain User его нет.
export type UserWithSecrets = User & {
  readonly passwordHash: string;
};
