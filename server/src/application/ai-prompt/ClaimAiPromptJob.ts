import type { AiPromptJob } from '../../domain/ai-prompt/AiPromptJob.js';
import {
  AiPromptJobAlreadyClaimedError,
  AiPromptJobNotFoundError,
  NotDispatcherForAiPromptJobError,
} from '../../domain/ai-prompt/errors.js';
import type { AiPromptJobRepository } from './AiPromptJobRepository.js';

type Deps = {
  readonly aiPromptJobs: AiPromptJobRepository;
};

export class ClaimAiPromptJob {
  constructor(private readonly deps: Deps) {}

  async execute(input: { userId: string; jobId: string }): Promise<AiPromptJob> {
    const job = await this.deps.aiPromptJobs.findById(input.jobId);
    if (!job) throw new AiPromptJobNotFoundError(input.jobId);
    if (job.dispatcherUserId !== input.userId) {
      throw new NotDispatcherForAiPromptJobError(input.jobId);
    }
    // AI-переработка бесплатна для всех — гейта плана/бюджета инициатора тут нет (см. EnqueueAiPromptJob).
    const claimed = await this.deps.aiPromptJobs.claimById(input.jobId);
    if (!claimed) throw new AiPromptJobAlreadyClaimedError(input.jobId);
    return claimed;
  }
}
