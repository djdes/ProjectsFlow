export type MagicToken = {
  readonly id: string;
  readonly email: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly createdAt: Date;
};

export type CreateMagicTokenInput = {
  readonly id: string;
  readonly email: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
};

export interface MagicTokenRepository {
  create(input: CreateMagicTokenInput): Promise<MagicToken>;
  findByHash(tokenHash: string): Promise<MagicToken | null>;
  markConsumed(id: string, at: Date): Promise<void>;
  countRecentForEmail(email: string, since: Date): Promise<number>;
  deleteExpired(): Promise<number>;
}
