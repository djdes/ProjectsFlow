import {
  AgentDeviceCodeAlreadyApprovedError,
  AgentDeviceCodeExpiredError,
  AgentDeviceCodeNotFoundError,
} from '../../domain/agent/errors.js';
import type { CreateAgentToken } from './CreateAgentToken.js';
import type { AgentDeviceCodeStore } from './AgentDeviceCodeStore.js';

type Deps = {
  readonly store: AgentDeviceCodeStore;
  readonly createAgentToken: CreateAgentToken;
  readonly now: () => Date;
};

export type ApproveAgentDeviceCodeCommand = {
  readonly userCode: string;
  readonly userId: string;
  readonly tokenName: string;
};

export class ApproveAgentDeviceCode {
  constructor(private readonly deps: Deps) {}

  async execute(input: ApproveAgentDeviceCodeCommand): Promise<void> {
    const entry = this.deps.store.getByUserCode(input.userCode);
    if (!entry) throw new AgentDeviceCodeNotFoundError();
    if (entry.expiresAt.getTime() <= this.deps.now().getTime()) {
      this.deps.store.expire(entry.deviceCode);
      throw new AgentDeviceCodeExpiredError();
    }
    if (entry.status !== 'pending') {
      // approved/consumed/denied/expired — pairing уже использован
      throw new AgentDeviceCodeAlreadyApprovedError();
    }

    // Создаём настоящий agent-токен — то же что юзер делает руками через UI,
    // только имя приходит из формы approve-диалога.
    const { token, plaintext } = await this.deps.createAgentToken.execute({
      userId: input.userId,
      name: input.tokenName,
    });

    this.deps.store.approve(input.userCode, {
      userId: input.userId,
      agentTokenId: token.id,
      agentTokenName: token.name,
      plaintextToken: plaintext,
    });
  }
}
