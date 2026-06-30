import type { AiPromptJob } from '../../domain/ai-prompt/AiPromptJob.js';
import {
  AiPromptJobAlreadyClaimedError,
  AiPromptJobNotFoundError,
  NotDispatcherForAiPromptJobError,
} from '../../domain/ai-prompt/errors.js';
import type { AiPromptJobRepository } from './AiPromptJobRepository.js';
import { assertBudgetAllowed, type CheckBudget } from '../usage/CheckBudget.js';

type Deps = {
  readonly aiPromptJobs: AiPromptJobRepository;
  // Гейт лимитов: подписка диспетчера исчерпала окно → claim запрещён (work не стартует).
  readonly checkBudget?: CheckBudget;
};

export class ClaimAiPromptJob {
  constructor(private readonly deps: Deps) {}

  async execute(input: { userId: string; jobId: string }): Promise<AiPromptJob> {
    const job = await this.deps.aiPromptJobs.findById(input.jobId);
    if (!job) throw new AiPromptJobNotFoundError(input.jobId);
    if (job.dispatcherUserId !== input.userId) {
      throw new NotDispatcherForAiPromptJobError(input.jobId);
    }
    await assertBudgetAllowed(this.deps.checkBudget, job.dispatcherUserId);
    const claimed = await this.deps.aiPromptJobs.claimById(input.jobId);
    if (!claimed) throw new AiPromptJobAlreadyClaimedError(input.jobId);
    return claimed;
  }
}
