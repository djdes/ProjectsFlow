import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { ServerRepository } from './ServerRepository.js';
import type { SnapshotRepository, TrendPoint, HistoryQuery } from './SnapshotRepository.js';
import type { MonitoringAlertRepository } from './MonitoringAlertRepository.js';
import type { ProjectServer } from '../../domain/monitoring/ProjectServer.js';
import type { LogTail, LogTails, ServerSnapshot } from '../../domain/monitoring/ServerSnapshot.js';
import type { ServerAlert } from '../../domain/monitoring/Alert.js';
import { ServerNotFoundError } from '../../domain/monitoring/errors.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly servers: ServerRepository;
  readonly snapshots: SnapshotRepository;
  readonly alerts: MonitoringAlertRepository;
};

// Read-операции мониторинга (все гейтятся view_monitoring). Сгруппированы в один
// сервис, чтобы не плодить почти одинаковые use-case'ы с общими зависимостями.
export class MonitoringQueries {
  constructor(private readonly deps: Deps) {}

  async getLatest(projectId: string, serverId: string, userId: string): Promise<ServerSnapshot | null> {
    await requireProjectAccess(this.deps, projectId, userId, 'view_monitoring');
    await this.ensureServer(projectId, serverId);
    return this.deps.snapshots.getLatest(serverId);
  }

  async getHistory(
    projectId: string,
    serverId: string,
    userId: string,
    query: HistoryQuery,
  ): Promise<TrendPoint[]> {
    await requireProjectAccess(this.deps, projectId, userId, 'view_monitoring');
    await this.ensureServer(projectId, serverId);
    return this.deps.snapshots.getHistory(serverId, query);
  }

  async getLogs(
    projectId: string,
    serverId: string,
    userId: string,
    kind: keyof LogTails,
  ): Promise<LogTail | null> {
    await requireProjectAccess(this.deps, projectId, userId, 'view_monitoring');
    await this.ensureServer(projectId, serverId);
    const latest = await this.deps.snapshots.getLatest(serverId);
    return latest?.logs?.[kind] ?? null;
  }

  async listAlerts(projectId: string, userId: string, activeOnly: boolean): Promise<ServerAlert[]> {
    await requireProjectAccess(this.deps, projectId, userId, 'view_monitoring');
    return activeOnly
      ? this.deps.alerts.listActiveByProject(projectId)
      : this.deps.alerts.listByProject(projectId, 100);
  }

  private async ensureServer(projectId: string, serverId: string): Promise<ProjectServer> {
    const server = await this.deps.servers.getById(serverId);
    if (!server || server.projectId !== projectId) throw new ServerNotFoundError();
    return server;
  }
}
