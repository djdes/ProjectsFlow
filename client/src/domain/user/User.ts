export type User = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  // Системный admin/root: открывает раздел /admin и глобальный доступ.
  readonly isAdmin: boolean;
};
