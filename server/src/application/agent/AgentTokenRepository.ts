import type { AgentToken } from '../../domain/agent/AgentToken.js';

export type CreateAgentTokenInput = {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly tokenHash: string;
  readonly tokenPrefix: string;
};

export interface AgentTokenRepository {
  create(input: CreateAgentTokenInput): Promise<AgentToken>;
  listByUser(userId: string): Promise<AgentToken[]>;
  // Поиск по hash — для аутентификации входящих запросов от агентов.
  // Возвращает только не-revoked токены.
  findActiveByHash(hash: string): Promise<AgentToken | null>;
  revoke(id: string, userId: string): Promise<boolean>;
  // Обновление lastUsedAt при успешном агент-запросе. Не критично к ошибкам.
  touchLastUsed(id: string): Promise<void>;
  // Сколько активных (не revoked) токенов у юзера. Используется в RevokeAgentToken:
  // если после revoke стало 0 — юзер больше не ralph-capable, надо снять его с роли
  // диспетчера во всех проектах (см. RevokeAgentToken use-case).
  countActiveByUser(userId: string): Promise<number>;
}
