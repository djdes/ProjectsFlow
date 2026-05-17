import type { AgentToken } from '@/domain/agent/AgentToken';

export type CreateAgentTokenResult = {
  readonly token: AgentToken;
  readonly plaintext: string; // приходит только в ответе на create — после этого не доступен
};

export interface AgentTokenRepository {
  list(): Promise<AgentToken[]>;
  create(name: string): Promise<CreateAgentTokenResult>;
  revoke(id: string): Promise<void>;
}
