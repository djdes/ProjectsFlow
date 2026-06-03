import type { ListProjects } from '../project/ListProjects.js';
import type { ServerRepository } from './ServerRepository.js';
import type { MonitoringAlertRepository } from './MonitoringAlertRepository.js';
import type { AlertSeverity, ServerAlert } from '../../domain/monitoring/Alert.js';

// Алерт + контекст проекта/сервера для кросс-проектной ленты.
export type AlertCenterItem = ServerAlert & {
  readonly projectName: string;
  readonly serverName: string | null;
};

export type AlertCenterResult = {
  readonly active: AlertCenterItem[];
  readonly recent: AlertCenterItem[];
};

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 3, warning: 2, info: 1 };
const RECENT_LIMIT = 30;

type Deps = {
  readonly listProjects: ListProjects;
  readonly servers: ServerRepository;
  readonly alerts: MonitoringAlertRepository;
};

// Кросс-проектный Alert Center: активные + недавно решённые алерты по всем проектам юзера.
// Доступ — членство (как GetMonitoringOverview); переиспользует существующие repo-методы.
export class GetAlertCenter {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<AlertCenterResult> {
    const projects = await this.deps.listProjects.execute(userId);
    const active: AlertCenterItem[] = [];
    const recent: AlertCenterItem[] = [];

    for (const p of projects) {
      if (p.isInbox) continue;
      const servers = await this.deps.servers.listByProject(p.id);
      if (servers.length === 0) continue;
      const nameById = new Map(servers.map((s) => [s.id, s.name]));
      const enrich = (a: ServerAlert): AlertCenterItem => ({
        ...a,
        projectName: p.name,
        serverName: nameById.get(a.serverId) ?? null,
      });

      for (const a of await this.deps.alerts.listActiveByProject(p.id)) active.push(enrich(a));
      for (const a of await this.deps.alerts.listByProject(p.id, 20)) {
        if (a.status === 'resolved') recent.push(enrich(a));
      }
    }

    // Активные: critical → warning → info, внутри — свежие сверху (по firstSeenAt).
    active.sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        b.firstSeenAt.getTime() - a.firstSeenAt.getTime(),
    );
    // Недавно решённые: по времени решения, новейшие сверху.
    recent.sort((a, b) => (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0));

    return { active, recent: recent.slice(0, RECENT_LIMIT) };
  }
}
