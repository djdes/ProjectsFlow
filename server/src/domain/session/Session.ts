export type Session = {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  // Сессия администратора, из которой вошли от имени пользователя. null — обычная сессия.
  readonly impersonatorSessionId: string | null;
};
