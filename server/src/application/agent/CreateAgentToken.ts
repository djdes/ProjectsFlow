import { AgentTokenNameEmptyError } from '../../domain/agent/errors.js';
import type { AgentToken } from '../../domain/agent/AgentToken.js';
import type { AgentTokenHasher } from './AgentTokenHasher.js';
import type { AgentTokenRepository } from './AgentTokenRepository.js';

type Deps = {
  readonly tokens: AgentTokenRepository;
  readonly hasher: AgentTokenHasher;
  readonly idGen: () => string;
  // Криптогенератор случайных байт для тела токена. Возвращает hex/base64-строку.
  readonly randomToken: () => string;
};

export type CreateAgentTokenCommand = {
  readonly userId: string;
  readonly name: string;
  readonly scope?: {
    readonly kind: 'project';
    readonly projectId: string;
    readonly taskId: string | null;
    readonly parentTokenId: string;
    readonly expiresAt: Date;
  };
};

// Результат с одноразовым plaintext-токеном — после этого вызова он недоступен нигде.
export type CreateAgentTokenResult = {
  readonly token: AgentToken;
  readonly plaintext: string;
};

const TOKEN_PREFIX = 'pfat_'; // ProjectsFlow Agent Token

export class CreateAgentToken {
  constructor(private readonly deps: Deps) {}

  async execute(input: CreateAgentTokenCommand): Promise<CreateAgentTokenResult> {
    const name = input.name.trim();
    if (name.length === 0) throw new AgentTokenNameEmptyError();

    // plaintext: префикс для опознания формата + crypto-random тело.
    const rawBody = this.deps.randomToken();
    const plaintext = `${TOKEN_PREFIX}${rawBody}`;
    const tokenHash = await this.deps.hasher.hash(plaintext);
    // Префикс для UI: первые 10 символов plaintext'а — даёт юзеру опознать токен
    // в списке без раскрытия секрета.
    const tokenPrefix = plaintext.slice(0, 10);

    const token = await this.deps.tokens.create({
      id: this.deps.idGen(),
      userId: input.userId,
      name,
      tokenHash,
      tokenPrefix,
      scopeKind: input.scope?.kind ?? 'account',
      projectId: input.scope?.projectId ?? null,
      taskId: input.scope?.taskId ?? null,
      parentTokenId: input.scope?.parentTokenId ?? null,
      expiresAt: input.scope?.expiresAt ?? null,
    });
    return { token, plaintext };
  }
}
