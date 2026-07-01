import {
  MonitoringAnalysisJobNotFoundError,
  MonitoringAnalysisJobNotInRunningStateError,
  NotDispatcherForMonitoringAnalysisJobError,
} from '../../domain/monitoring-analysis/errors.js';
import type { MonitoringAnalysisJobRepository } from './MonitoringAnalysisJobRepository.js';
import type { RecordUsage } from '../usage/RecordUsage.js';

const MAX_RESULT = 300_000;
const MAX_ERROR = 500;

type Deps = {
  readonly monitoringAnalysisJobs: MonitoringAnalysisJobRepository;
  // Метеринг расхода ИИ (best-effort) — списываем с подписки диспетчера.
  readonly recordUsage?: RecordUsage;
};

export type CompleteMonitoringAnalysisJobInput = {
  readonly userId: string;
  readonly jobId: string;
  readonly ok: boolean;
  readonly resultMarkdown: string | null;
  readonly error: string | null;
  readonly costUsd?: number | null;
  readonly tokensIn?: number | null;
  readonly tokensOut?: number | null;
};

export class CompleteMonitoringAnalysisJob {
  constructor(private readonly deps: Deps) {}

  async execute(input: CompleteMonitoringAnalysisJobInput): Promise<void> {
    const job = await this.deps.monitoringAnalysisJobs.findById(input.jobId);
    if (!job) throw new MonitoringAnalysisJobNotFoundError(input.jobId);
    if (job.dispatcherUserId !== input.userId) {
      throw new NotDispatcherForMonitoringAnalysisJobError(input.jobId);
    }
    if (job.status !== 'running') {
      throw new MonitoringAnalysisJobNotInRunningStateError(input.jobId, job.status);
    }

    if (input.ok) {
      const text = (input.resultMarkdown ?? '').trim();
      if (text.length === 0) throw new Error('ok=true requires non-empty resultMarkdown');
      await this.deps.monitoringAnalysisJobs.complete({
        id: input.jobId,
        status: 'succeeded',
        resultMarkdown: text.length > MAX_RESULT ? text.slice(0, MAX_RESULT) : text,
        error: null,
        costUsd: input.costUsd ?? null,
        tokensIn: input.tokensIn ?? null,
        tokensOut: input.tokensOut ?? null,
      });
    } else {
      const err = (input.error ?? '').trim();
      if (err.length === 0) throw new Error('ok=false requires non-empty error');
      await this.deps.monitoringAnalysisJobs.complete({
        id: input.jobId,
        status: 'failed',
        resultMarkdown: null,
        error: err.slice(0, MAX_ERROR),
        costUsd: input.costUsd ?? null,
        tokensIn: input.tokensIn ?? null,
        tokensOut: input.tokensOut ?? null,
      });
    }

    // Метеринг: списываем с профиля ИНИЦИАТОРА (createdBy), best-effort, идемпотентно по source+ref.
    void this.deps.recordUsage
      ?.execute({
        source: 'monitoring',
        refId: input.jobId,
        dispatcherUserId: job.createdBy,
        projectId: job.projectId,
        model: null,
        tokensIn: input.tokensIn ?? null,
        tokensOut: input.tokensOut ?? null,
        costUsd: input.costUsd ?? null,
      })
      .catch(() => {});
  }
}
