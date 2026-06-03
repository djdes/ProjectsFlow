import type { MonitoringAnalysisJob } from '../../domain/monitoring-analysis/MonitoringAnalysisJob.js';
import {
  MonitoringAnalysisJobAccessDeniedError,
  MonitoringAnalysisJobNotFoundError,
} from '../../domain/monitoring-analysis/errors.js';
import type { MonitoringAnalysisJobRepository } from './MonitoringAnalysisJobRepository.js';

const POLL_INTERVAL_MS = 500;
const DEFAULT_MAX_WAIT_MS = 25_000;
const HARD_MAX_WAIT_MS = 60_000;
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);

type Deps = {
  readonly monitoringAnalysisJobs: MonitoringAnalysisJobRepository;
  readonly isAdmin: (userId: string) => Promise<boolean>;
};

export type WaitForMonitoringAnalysisJobInput = {
  readonly userId: string;
  readonly jobId: string;
  readonly maxWaitMs?: number;
};

// Возвращает job в терминальном состоянии. null = таймаут (handler → 504).
export class WaitForMonitoringAnalysisJob {
  constructor(private readonly deps: Deps) {}

  async execute(input: WaitForMonitoringAnalysisJobInput): Promise<MonitoringAnalysisJob | null> {
    const maxWait = Math.min(input.maxWaitMs ?? DEFAULT_MAX_WAIT_MS, HARD_MAX_WAIT_MS);
    const deadline = Date.now() + maxWait;

    const first = await this.deps.monitoringAnalysisJobs.findById(input.jobId);
    if (!first) throw new MonitoringAnalysisJobNotFoundError(input.jobId);
    if (first.createdBy !== input.userId && !(await this.deps.isAdmin(input.userId))) {
      throw new MonitoringAnalysisJobAccessDeniedError(input.jobId);
    }
    if (TERMINAL_STATUSES.has(first.status)) return first;

    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const job = await this.deps.monitoringAnalysisJobs.findById(input.jobId);
      if (!job) throw new MonitoringAnalysisJobNotFoundError(input.jobId);
      if (TERMINAL_STATUSES.has(job.status)) return job;
    }
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
