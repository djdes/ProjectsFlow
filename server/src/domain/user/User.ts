export type User = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly createdAt: Date;
};

// Internal type, не утекает за пределы infrastructure/application.
// passwordHash хранится в БД и сравнивается на login; в domain User его нет.
export type UserWithSecrets = User & {
  readonly passwordHash: string;
};
