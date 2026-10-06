import type { AiPromptJobMode } from '../../domain/ai-prompt/AiPromptJob.js';
import type {
  AiPromptJobRepository,
  PendingAiPromptJob,
} from './AiPromptJobRepository.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

type Deps = {
  readonly aiPromptJobs: AiPromptJobRepository;
  // Режимы, которые сейчас исполняет сам сервер (подписка ChatGPT) — диспетчер их не видит.
  readonly serverHandledModes?: () => Promise<readonly AiPromptJobMode[]>;
};

export class ListPendingAiPromptJobs {
  constructor(private readonly deps: Deps) {}

  async execute(input: { userId: string; limit?: number }): Promise<PendingAiPromptJob[]> {
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const excludeModes = this.deps.serverHandledModes ? await this.deps.serverHandledModes() : [];
    return this.deps.aiPromptJobs.listPendingForDispatcher(input.userId, limit, { excludeModes });
  }
}
