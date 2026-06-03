import type { MonitoringAnalysisJob } from '../../domain/monitoring-analysis/MonitoringAnalysisJob.js';
import { ServerNotFoundError } from '../../domain/monitoring/errors.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { ServerRepository } from '../monitoring/ServerRepository.js';
import type { MonitoringAnalysisJobRepository } from './MonitoringAnalysisJobRepository.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly servers: ServerRepository;
  readonly monitoringAnalysisJobs: MonitoringAnalysisJobRepository;
};

// История анализов сервера для таба «AI». Читать может любой участник (view_monitoring).
export class ListServerAnalysisHistory {
  constructor(private readonly deps: Deps) {}

  async execute(input: {
    projectId: string;
    serverId: string;
    userId: string;
    limit?: number;
  }): Promise<MonitoringAnalysisJob[]> {
    await requireProjectAccess(this.deps, input.projectId, input.userId, 'view_monitoring');
    const server = await this.deps.servers.getById(input.serverId);
    if (!server || server.projectId !== input.projectId) throw new ServerNotFoundError();
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    return this.deps.monitoringAnalysisJobs.listByServer(input.serverId, limit);
  }
}
