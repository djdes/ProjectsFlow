import type { MonitoringAnalysisJob, MonitoringAnalysisType } from '../../domain/monitoring-analysis/MonitoringAnalysisJob.js';
import { MonitoringAnalysisProjectHasNoDispatcherError } from '../../domain/monitoring-analysis/errors.js';
import { ServerNotFoundError } from '../../domain/monitoring/errors.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { InMemoryRateLimiter } from '../../infrastructure/ratelimit/InMemoryRateLimiter.js';
import type { ServerRepository } from '../monitoring/ServerRepository.js';
import type { SnapshotRepository } from '../monitoring/SnapshotRepository.js';
import type { MonitoringAlertRepository } from '../monitoring/MonitoringAlertRepository.js';
import type { MonitoringAnalysisJobRepository } from './MonitoringAnalysisJobRepository.js';
import { prepareMonitoringContext } from './prepareMonitoringContext.js';

// Анализ дороже AI-improve (большой пред-собранный контекст) → строже лимит, ближе к compose.
const RATE_LIMIT_PER_HOUR = 15;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const MAX_NOTE = 2000;

export class MonitoringAnalysisRateLimitedError extends Error {
  constructor() {
    super('Превышен лимит AI-анализа (15 в час). Попробуй позже.');
    this.name = 'MonitoringAnalysisRateLimitedError';
  }
}

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly servers: ServerRepository;
  readonly snapshots: SnapshotRepository;
  readonly alerts: MonitoringAlertRepository;
  readonly monitoringAnalysisJobs: MonitoringAnalysisJobRepository;
  readonly rateLimiter: InMemoryRateLimiter;
};

export type EnqueueMonitoringAnalysisJobInput = {
  readonly userId: string;
  readonly projectId: string;
  readonly serverId: string;
  readonly analysisType?: MonitoringAnalysisType;
  readonly alertId?: string | null;
  readonly note?: string | null;
};

export class EnqueueMonitoringAnalysisJob {
  constructor(private readonly deps: Deps) {}

  async execute(input: EnqueueMonitoringAnalysisJobInput): Promise<MonitoringAnalysisJob> {
    // Rate-limit до permission-check (как в ai-prompt) — перебор serverId не обходит лимит.
    if (!this.deps.rateLimiter.hit(`monitoring-analysis:${input.userId}`, RATE_LIMIT_PER_HOUR, RATE_LIMIT_WINDOW_MS)) {
      throw new MonitoringAnalysisRateLimitedError();
    }

    // Запуск анализа жжёт токены диспетчера → требуем manage_monitoring (editor+).
    const { project } = await requireProjectAccess(this.deps, input.projectId, input.userId, 'manage_monitoring');
    if (!project.dispatcherUserId) {
      throw new MonitoringAnalysisProjectHasNoDispatcherError(input.projectId);
    }

    const server = await this.deps.servers.getById(input.serverId);
    if (!server || server.projectId !== input.projectId) throw new ServerNotFoundError();

    const analysisType: MonitoringAnalysisType = input.analysisType ?? 'snapshot';
    const context = await prepareMonitoringContext(this.deps, {
      serverId: input.serverId,
      projectId: input.projectId,
      analysisType,
    });

    return this.deps.monitoringAnalysisJobs.create({
      createdBy: input.userId,
      projectId: input.projectId,
      serverId: input.serverId,
      dispatcherUserId: project.dispatcherUserId,
      analysisType,
      alertId: input.alertId ?? null,
      context,
      note: input.note ? input.note.slice(0, MAX_NOTE) : null,
    });
  }
}
