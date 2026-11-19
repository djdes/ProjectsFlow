export type User = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  // Системный admin/root: открывает раздел /admin и глобальный доступ.
  readonly isAdmin: boolean;
  // Администратор вошёл от имени этого пользователя (админка → «Войти как»). Только в /auth/me.
  readonly impersonatedBy?: { readonly id: string; readonly displayName: string } | null;
};
