import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ServerRepository } from './ServerRepository.js';
import type { MonitoringAlertRepository } from './MonitoringAlertRepository.js';
import type { MonitoringAlertNotifier } from './MonitoringAlertNotifier.js';
import type { ProjectServer } from '../../domain/monitoring/ProjectServer.js';
import type { ServerSnapshot } from '../../domain/monitoring/ServerSnapshot.js';
import type { AlertKind, ServerAlert } from '../../domain/monitoring/Alert.js';
import {
  ALERT_RENOTIFY_MS,
  DEFAULT_SNAPSHOT_STALE_MINUTES,
  evaluateSnapshotConditions,
  stalenessCondition,
  type AlertCondition,
} from '../../domain/monitoring/alertRules.js';

type Deps = {
  readonly alerts: MonitoringAlertRepository;
  readonly servers: ServerRepository;
  readonly projects: ProjectRepository;
  readonly notifier: MonitoringAlertNotifier;
  readonly idGen: () => string;
  readonly now: () => Date;
  readonly staleMinutes?: number;
};

const SNAPSHOT_RULES: AlertKind[] = ['process_down', 'disk_usage', 'restart_spike'];
const STALENESS_RULES: AlertKind[] = ['snapshot_stale'];

// Оценка правил и согласование с журналом алертов (state-machine firing/resolved + дедуп).
// Вызывается: (1) на каждый сохранённый снимок через onSnapshotStored-хук; (2) периодически
// для staleness-sweep'а (нет свежего снимка → сервер замолчал).
export class EvaluateAlerts {
  constructor(private readonly deps: Deps) {}

  // Удобная точка для onSnapshotStored-хука: грузит сервер по снимку и оценивает.
  async onSnapshotStored(snapshot: ServerSnapshot, prev: ServerSnapshot | null): Promise<void> {
    const server = await this.deps.servers.getById(snapshot.serverId);
    if (server) await this.evaluateForSnapshot(server, snapshot, prev);
  }

  async evaluateForSnapshot(
    server: ProjectServer,
    snapshot: ServerSnapshot,
    prev: ServerSnapshot | null,
  ): Promise<void> {
    const conditions = evaluateSnapshotConditions({
      reachable: snapshot.reachable,
      metrics: snapshot.metrics,
      prevMetrics: prev?.metrics ?? null,
    });
    await this.reconcile(server, conditions, SNAPSHOT_RULES);
  }

  // Server-level staleness: для каждого enabled-сервера, если последний снимок старше порога —
  // поднимаем snapshot_stale, иначе тушим.
  async sweepStaleness(): Promise<void> {
    const staleMin = this.deps.staleMinutes ?? DEFAULT_SNAPSHOT_STALE_MINUTES;
    const staleMs = staleMin * 60 * 1000;
    const now = this.deps.now().getTime();
    const servers = await this.deps.servers.listEnabled();
    for (const s of servers) {
      const isStale = s.lastSnapshotAt ? now - s.lastSnapshotAt.getTime() > staleMs : false;
      const conditions = isStale ? [stalenessCondition(staleMin)] : [];
      try {
        await this.reconcile(s, conditions, STALENESS_RULES);
      } catch (err) {
        console.warn('[monitoring-alert] staleness sweep failed for', s.id, err);
      }
    }
  }

  private async reconcile(
    server: ProjectServer,
    conditions: AlertCondition[],
    ruleKindsHandled: AlertKind[],
  ): Promise<void> {
    const project = await this.deps.projects.getById(server.projectId);
    if (!project) return;

    const active = await this.deps.alerts.listActiveByServer(server.id);
    const activeByKey = new Map(active.map((a) => [`${a.ruleKind}:${a.dedupKey}`, a]));
    const seen = new Set<string>();
    const now = this.deps.now();

    for (const c of conditions) {
      const key = `${c.ruleKind}:${c.dedupKey}`;
      seen.add(key);
      const existing = activeByKey.get(key);
      if (!existing) {
        const alert: ServerAlert = {
          id: this.deps.idGen(),
          serverId: server.id,
          projectId: server.projectId,
          ruleKind: c.ruleKind,
          dedupKey: c.dedupKey,
          severity: c.severity,
          status: 'firing',
          message: c.message,
          details: c.details,
          firstSeenAt: now,
          lastSeenAt: now,
          resolvedAt: null,
          lastNotifiedAt: now,
          createdAt: now,
        };
        await this.deps.alerts.insert(alert);
        await this.deps.notifier.notify({ server, project, alert });
      } else {
        await this.deps.alerts.touchLastSeen(existing.id, now);
        // Повторное уведомление по всё ещё горящему алерту — не чаще ALERT_RENOTIFY_MS.
        const lastNotified = existing.lastNotifiedAt?.getTime() ?? 0;
        if (now.getTime() - lastNotified > ALERT_RENOTIFY_MS) {
          await this.deps.alerts.markNotified(existing.id, now);
          await this.deps.notifier.notify({
            server,
            project,
            alert: { ...existing, lastSeenAt: now, lastNotifiedAt: now },
          });
        }
      }
    }

    // Условие исчезло → тушим (только по правилам, которые сейчас оценивали).
    for (const a of active) {
      if (!ruleKindsHandled.includes(a.ruleKind)) continue;
      const key = `${a.ruleKind}:${a.dedupKey}`;
      if (!seen.has(key)) {
        await this.deps.alerts.resolve(a.id, now);
        await this.deps.notifier.notify({
          server,
          project,
          alert: { ...a, status: 'resolved', resolvedAt: now },
        });
      }
    }
  }
}
