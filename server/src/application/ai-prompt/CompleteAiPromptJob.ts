import {
  AiPromptJobNotFoundError,
  AiPromptJobNotInRunningStateError,
  NotDispatcherForAiPromptJobError,
} from '../../domain/ai-prompt/errors.js';
import type { AiPromptJobRepository } from './AiPromptJobRepository.js';

const MAX_IMPROVED_TEXT = 5000;
const MAX_ERROR = 500;

type Deps = {
  readonly aiPromptJobs: AiPromptJobRepository;
};

export type CompleteAiPromptJobInput = {
  readonly userId: string;
  readonly jobId: string;
  readonly ok: boolean;
  readonly improvedText: string | null;
  readonly error: string | null;
};

export class CompleteAiPromptJob {
  constructor(private readonly deps: Deps) {}

  async execute(input: CompleteAiPromptJobInput): Promise<void> {
    const job = await this.deps.aiPromptJobs.findById(input.jobId);
    if (!job) throw new AiPromptJobNotFoundError(input.jobId);
    if (job.dispatcherUserId !== input.userId) {
      throw new NotDispatcherForAiPromptJobError(input.jobId);
    }
    if (job.status !== 'running') {
      throw new AiPromptJobNotInRunningStateError(input.jobId, job.status);
    }

    if (input.ok) {
      const text = (input.improvedText ?? '').trim();
      if (text.length === 0) {
        throw new Error('ok=true requires non-empty improvedText');
      }
      const truncated = text.length > MAX_IMPROVED_TEXT ? text.slice(0, MAX_IMPROVED_TEXT) : text;
      await this.deps.aiPromptJobs.complete({
        id: input.jobId,
        status: 'succeeded',
        improvedText: truncated,
        error: null,
      });
    } else {
      const err = (input.error ?? '').trim();
      if (err.length === 0) throw new Error('ok=false requires non-empty error');
      await this.deps.aiPromptJobs.complete({
        id: input.jobId,
        status: 'failed',
        improvedText: null,
        error: err.slice(0, MAX_ERROR),
      });
    }
  }
}
