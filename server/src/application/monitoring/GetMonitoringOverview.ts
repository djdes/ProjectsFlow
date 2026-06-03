import type { ListProjects } from '../project/ListProjects.js';
import type { ServerRepository } from './ServerRepository.js';
import type { SnapshotRepository } from './SnapshotRepository.js';
import type { MonitoringAlertRepository } from './MonitoringAlertRepository.js';
import type { ServerHealthStatus } from '../../domain/monitoring/ServerSnapshot.js';
import type { ServerKind } from '../../domain/monitoring/ProjectServer.js';

export type OverviewServer = {
  readonly id: string;
  readonly name: string;
  readonly kind: ServerKind;
  readonly status: ServerHealthStatus;
  readonly lastSnapshotAt: Date | null;
};

export type OverviewProject = {
  readonly projectId: string;
  readonly projectName: string;
  readonly servers: OverviewServer[];
  readonly activeAlerts: number;
  // Худшая severity активных алертов проекта (для сортировки/фильтра on-call). null — нет алертов.
  readonly worstSeverity: 'critical' | 'warning' | 'info' | null;
  // Худший статус серверов проекта (для сортировки «где горит» выше).
  readonly worstStatus: ServerHealthStatus;
};

const STATUS_RANK: Record<ServerHealthStatus, number> = {
  down: 4,
  degraded: 3,
  stale: 2,
  unknown: 1,
  ok: 0,
};

type Deps = {
  readonly listProjects: ListProjects;
  readonly servers: ServerRepository;
  readonly snapshots: SnapshotRepository;
  readonly alerts: MonitoringAlertRepository;
};

// Сводка «здоровье всех проектов» для текущего юзера: по каждому его проекту (где есть
// серверы) — статусы серверов + число активных алертов. Доступ — членство (view_monitoring=viewer).
export class GetMonitoringOverview {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<OverviewProject[]> {
    const projects = await this.deps.listProjects.execute(userId);
    const out: OverviewProject[] = [];
    for (const p of projects) {
      if (p.isInbox) continue;
      const servers = await this.deps.servers.listByProject(p.id);
      if (servers.length === 0) continue;
      const latest = await this.deps.snapshots.listLatestPerServer(p.id);
      const active = await this.deps.alerts.listActiveByProject(p.id);
      const serverViews = servers.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        status: latest.get(s.id)?.status ?? s.lastStatus ?? 'unknown',
        lastSnapshotAt: s.lastSnapshotAt,
      }));
      const worstSeverity = active.some((a) => a.severity === 'critical')
        ? 'critical'
        : active.some((a) => a.severity === 'warning')
          ? 'warning'
          : active.length > 0
            ? 'info'
            : null;
      const worstStatus = serverViews.reduce<ServerHealthStatus>(
        (worst, s) => (STATUS_RANK[s.status] > STATUS_RANK[worst] ? s.status : worst),
        'ok',
      );
      out.push({
        projectId: p.id,
        projectName: p.name,
        servers: serverViews,
        activeAlerts: active.length,
        worstSeverity,
        worstStatus,
      });
    }
    return out;
  }
}
