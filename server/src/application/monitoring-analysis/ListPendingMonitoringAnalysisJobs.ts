import type {
  MonitoringAnalysisJobRepository,
  PendingMonitoringAnalysisJob,
} from './MonitoringAnalysisJobRepository.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

type Deps = {
  readonly monitoringAnalysisJobs: MonitoringAnalysisJobRepository;
};

export class ListPendingMonitoringAnalysisJobs {
  constructor(private readonly deps: Deps) {}

  async execute(input: { userId: string; limit?: number }): Promise<PendingMonitoringAnalysisJob[]> {
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    return this.deps.monitoringAnalysisJobs.listPendingForDispatcher(input.userId, limit);
  }
}
