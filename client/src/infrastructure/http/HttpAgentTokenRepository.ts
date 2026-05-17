import type { AgentToken } from '@/domain/agent/AgentToken';
import type {
  AgentTokenRepository,
  CreateAgentTokenResult,
} from '@/application/agent/AgentTokenRepository';
import { httpClient } from './httpClient';

type TokenDto = Omit<AgentToken, 'createdAt' | 'lastUsedAt' | 'revokedAt'> & {
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

function fromDto(dto: TokenDto): AgentToken {
  return {
    ...dto,
    createdAt: new Date(dto.createdAt),
    lastUsedAt: dto.lastUsedAt ? new Date(dto.lastUsedAt) : null,
    revokedAt: dto.revokedAt ? new Date(dto.revokedAt) : null,
  };
}

export class HttpAgentTokenRepository implements AgentTokenRepository {
  async list(): Promise<AgentToken[]> {
    const { tokens } = await httpClient.get<{ tokens: TokenDto[] }>('/agent/tokens');
    return tokens.map(fromDto);
  }
  async create(name: string): Promise<CreateAgentTokenResult> {
    const { token, plaintext } = await httpClient.post<{ token: TokenDto; plaintext: string }>(
      '/agent/tokens',
      { name },
    );
    return { token: fromDto(token), plaintext };
  }
  async revoke(id: string): Promise<void> {
    await httpClient.delete<void>(`/agent/tokens/${id}`);
  }
}
