// Сущность agent-токена. Plaintext-значение токена живёт только в момент генерации —
// в БД хранится hash. Поэтому в domain-объекте plaintext'а нет.
export type AgentToken = {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly tokenPrefix: string;  // первые ~10 символов plaintext'а, для UI
  // Account tokens belong to the dispatcher process. Project capabilities are
  // short-lived child tokens handed to one worker and enforced server-side.
  readonly scopeKind: 'account' | 'project';
  readonly projectId: string | null;
  readonly taskId: string | null;
  readonly parentTokenId: string | null;
  readonly expiresAt: Date | null;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
};
