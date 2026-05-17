export type AgentToken = {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly tokenPrefix: string;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
};
