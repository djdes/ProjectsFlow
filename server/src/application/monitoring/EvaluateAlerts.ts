import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ServerRepository } from './ServerRepository.js';
import type { SnapshotRepository } from './SnapshotRepository.js';
import type { MonitoringAlertRepository } from './MonitoringAlertRepository.js';
import { detectAnomaly } from '../../domain/monitoring/anomaly.js';
import type { MonitoringAlertRuleRepository } from './MonitoringAlertRuleRepository.js';
import type { MonitoringAlertNotifier } from './MonitoringAlertNotifier.js';
import type { ProjectServer } from '../../domain/monitoring/ProjectServer.js';
import type { ServerSnapshot } from '../../domain/monitoring/ServerSnapshot.js';
import type { AlertKind, ServerAlert } from '../../domain/monitoring/Alert.js';
import {
  ALERT_RENOTIFY_MS,
  DEFAULT_RULE_CONFIG,
  DEFAULT_SNAPSHOT_STALE_MINUTES,
  evaluateSnapshotConditions,
  resolveRuleConfig,
  stalenessCondition,
  type AlertCondition,
  type AlertRuleConfig,
} from '../../domain/monitoring/alertRules.js';

type Deps = {
  readonly alerts: MonitoringAlertRepository;
  readonly servers: ServerRepository;
  readonly snapshots: SnapshotRepository;
  readonly projects: ProjectRepository;
  readonly notifier: MonitoringAlertNotifier;
  readonly idGen: () => string;
  readonly now: () => Date;
  // Per-project оверрайды порогов (optional — без репо берутся дефолты).
  readonly rules?: MonitoringAlertRuleRepository;
  // Авто-анализ при первом firing critical-алерта (optional). Best-effort, не блокирует.
  readonly autoAnalyzeCriticalAlert?: (input: {
    projectId: string;
    serverId: string;
    alertId: string;
  }) => Promise<void>;
};

const SNAPSHOT_RULES: AlertKind[] = [
  'process_down',
  'disk_usage',
  'restart_spike',
  'http_down',
  'ssl_expiry',
];
const STALENESS_RULES: AlertKind[] = ['snapshot_stale'];
const ANOMALY_RULES: AlertKind[] = ['metric_anomaly'];
// Метрики, по которым ищем аномалии (ползущая деградация). Ключи — поля TrendPoint.
const ANOMALY_METRICS: { key: 'memUsedPct' | 'cpuLoad1'; label: string }[] = [
  { key: 'memUsedPct', label: 'память %' },
  { key: 'cpuLoad1', label: 'load (1m)' },
];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

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

  private async loadConfig(projectId: string): Promise<AlertRuleConfig> {
    if (!this.deps.rules) return DEFAULT_RULE_CONFIG;
    try {
      return resolveRuleConfig(await this.deps.rules.listByProject(projectId));
    } catch {
      return DEFAULT_RULE_CONFIG;
    }
  }

  async evaluateForSnapshot(
    server: ProjectServer,
    snapshot: ServerSnapshot,
    prev: ServerSnapshot | null,
  ): Promise<void> {
    const config = await this.loadConfig(server.projectId);
    const conditions = evaluateSnapshotConditions({
      reachable: snapshot.reachable,
      metrics: snapshot.metrics,
      prevMetrics: prev?.metrics ?? null,
      config,
    });
    await this.reconcile(server, conditions, SNAPSHOT_RULES);
  }

  // Server-level staleness: для каждого enabled-сервера, если последний снимок старше порога —
  // поднимаем snapshot_stale, иначе тушим. Порог/enabled — из per-project правил.
  async sweepStaleness(): Promise<void> {
    const now = this.deps.now().getTime();
    const servers = await this.deps.servers.listEnabled();
    for (const s of servers) {
      try {
        const config = await this.loadConfig(s.projectId);
        const rule = config.snapshot_stale;
        const staleMin = rule.threshold ?? DEFAULT_SNAPSHOT_STALE_MINUTES;
        const isStale =
          rule.enabled && s.lastSnapshotAt
            ? now - s.lastSnapshotAt.getTime() > staleMin * 60 * 1000
            : false;
        const conditions = isStale ? [stalenessCondition(staleMin, rule.severity)] : [];
        await this.reconcile(s, conditions, STALENESS_RULES);
      } catch (err) {
        console.warn('[monitoring-alert] staleness sweep failed for', s.id, err);
      }
    }
  }

  // Sweep аномалий: для каждого сервера строим baseline по 24ч-истории метрики и флагуем
  // устойчивое отклонение > k·σ. Адаптивно к серверу (без ручных порогов). Запускается по
  // интервалу (нужна история — в per-snapshot не оценить). reconcile тушит, когда аномалия ушла.
  async sweepAnomalies(): Promise<void> {
    const since = new Date(this.deps.now().getTime() - 24 * 3600 * 1000);
    const servers = await this.deps.servers.listEnabled();
    for (const s of servers) {
      try {
        const config = await this.loadConfig(s.projectId);
        const rule = config.metric_anomaly;
        if (!rule.enabled) continue;
        const k = rule.threshold ?? 3;
        const points = await this.deps.snapshots.getHistory(s.id, { since, limit: 500 });
        const conditions: AlertCondition[] = [];
        for (const m of ANOMALY_METRICS) {
          const res = detectAnomaly(
            points.map((p) => p[m.key]),
            { k, minConsecutive: 3, minPoints: 24 },
          );
          if (res?.isAnomaly) {
            conditions.push({
              ruleKind: 'metric_anomaly',
              dedupKey: m.key,
              severity: rule.severity,
              message: `Аномалия: ${m.label} = ${round1(res.last)} (база ${round1(res.mean)}±${round1(res.stddev)}, >${k}σ)`,
              details: { metric: m.key, last: res.last, mean: res.mean, stddev: res.stddev, k },
            });
          }
        }
        await this.reconcile(s, conditions, ANOMALY_RULES);
      } catch (err) {
        console.warn('[monitoring-alert] anomaly sweep failed for', s.id, err);
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
    // «Тихий час»: алерты пишем в журнал, но уведомления подавляем.
    const muted = server.mutedUntil != null && server.mutedUntil.getTime() > now.getTime();
    const notify = async (alert: ServerAlert): Promise<void> => {
      if (muted) return;
      await this.deps.notifier.notify({ server, project, alert });
    };

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
        await notify(alert);
        // Авто-анализ через диспетчера при критическом алерте (best-effort, дедуп внутри).
        if (alert.severity === 'critical' && this.deps.autoAnalyzeCriticalAlert) {
          try {
            await this.deps.autoAnalyzeCriticalAlert({
              projectId: server.projectId,
              serverId: server.id,
              alertId: alert.id,
            });
          } catch (err) {
            console.warn('[monitoring-alert] auto-analyze failed for', alert.id, err);
          }
        }
      } else {
        await this.deps.alerts.touchLastSeen(existing.id, now);
        // Повторное уведомление по всё ещё горящему алерту — не чаще ALERT_RENOTIFY_MS.
        const lastNotified = existing.lastNotifiedAt?.getTime() ?? 0;
        if (!muted && now.getTime() - lastNotified > ALERT_RENOTIFY_MS) {
          await this.deps.alerts.markNotified(existing.id, now);
          await notify({ ...existing, lastSeenAt: now, lastNotifiedAt: now });
        }
      }
    }

    // Условие исчезло → тушим (только по правилам, которые сейчас оценивали).
    for (const a of active) {
      if (!ruleKindsHandled.includes(a.ruleKind)) continue;
      const key = `${a.ruleKind}:${a.dedupKey}`;
      if (!seen.has(key)) {
        await this.deps.alerts.resolve(a.id, now);
        await notify({ ...a, status: 'resolved', resolvedAt: now });
      }
    }
  }
}
