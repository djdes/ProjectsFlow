import type { AiPromptJob } from '../../domain/ai-prompt/AiPromptJob.js';
import {
  AiPromptJobAccessDeniedError,
  AiPromptJobNotFoundError,
} from '../../domain/ai-prompt/errors.js';
import type { AiPromptJobRepository } from './AiPromptJobRepository.js';

const POLL_INTERVAL_MS = 500;
const DEFAULT_MAX_WAIT_MS = 25_000;
const HARD_MAX_WAIT_MS = 60_000;

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);

type Deps = {
  readonly aiPromptJobs: AiPromptJobRepository;
  /** Резолвер «является ли userId системным админом». */
  readonly isAdmin: (userId: string) => Promise<boolean>;
};

export type WaitForAiPromptJobInput = {
  readonly userId: string;
  readonly jobId: string;
  /** Default 25s, max 60s. */
  readonly maxWaitMs?: number;
};

/**
 * Возвращает job в терминальном состоянии. null = вышли по таймауту (handler → 504).
 */
export class WaitForAiPromptJob {
  constructor(private readonly deps: Deps) {}

  async execute(input: WaitForAiPromptJobInput): Promise<AiPromptJob | null> {
    const maxWait = Math.min(input.maxWaitMs ?? DEFAULT_MAX_WAIT_MS, HARD_MAX_WAIT_MS);
    const deadline = Date.now() + maxWait;

    const first = await this.deps.aiPromptJobs.findById(input.jobId);
    if (!first) throw new AiPromptJobNotFoundError(input.jobId);
    if (first.createdBy !== input.userId && !(await this.deps.isAdmin(input.userId))) {
      throw new AiPromptJobAccessDeniedError(input.jobId);
    }
    if (TERMINAL_STATUSES.has(first.status)) return first;

    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const job = await this.deps.aiPromptJobs.findById(input.jobId);
      if (!job) throw new AiPromptJobNotFoundError(input.jobId);
      if (TERMINAL_STATUSES.has(job.status)) return job;
    }
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
