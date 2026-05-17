// Сущность agent-токена. Plaintext-значение токена живёт только в момент генерации —
// в БД хранится hash. Поэтому в domain-объекте plaintext'а нет.
export type AgentToken = {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly tokenPrefix: string;  // первые ~10 символов plaintext'а, для UI
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
};
