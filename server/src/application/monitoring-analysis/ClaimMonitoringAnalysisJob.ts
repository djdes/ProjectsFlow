import type { MonitoringAnalysisJob } from '../../domain/monitoring-analysis/MonitoringAnalysisJob.js';
import {
  MonitoringAnalysisJobAlreadyClaimedError,
  MonitoringAnalysisJobNotFoundError,
  NotDispatcherForMonitoringAnalysisJobError,
} from '../../domain/monitoring-analysis/errors.js';
import type { MonitoringAnalysisJobRepository } from './MonitoringAnalysisJobRepository.js';
import { assertBudgetAllowed, type CheckBudget } from '../usage/CheckBudget.js';

type Deps = {
  readonly monitoringAnalysisJobs: MonitoringAnalysisJobRepository;
  // Гейт лимитов: подписка диспетчера исчерпала окно → claim запрещён.
  readonly checkBudget?: CheckBudget;
};

export class ClaimMonitoringAnalysisJob {
  constructor(private readonly deps: Deps) {}

  async execute(input: { userId: string; jobId: string }): Promise<MonitoringAnalysisJob> {
    const job = await this.deps.monitoringAnalysisJobs.findById(input.jobId);
    if (!job) throw new MonitoringAnalysisJobNotFoundError(input.jobId);
    if (job.dispatcherUserId !== input.userId) {
      throw new NotDispatcherForMonitoringAnalysisJobError(input.jobId);
    }
    await assertBudgetAllowed(this.deps.checkBudget, job.dispatcherUserId);
    const claimed = await this.deps.monitoringAnalysisJobs.claimById(input.jobId);
    if (!claimed) throw new MonitoringAnalysisJobAlreadyClaimedError(input.jobId);
    return claimed;
  }
}
