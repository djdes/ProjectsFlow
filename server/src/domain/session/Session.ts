export type Session = {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
};
