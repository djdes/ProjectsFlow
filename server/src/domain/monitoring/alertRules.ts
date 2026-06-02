import type { AlertKind, AlertSeverity } from './Alert.js';
import type { SnapshotMetrics } from './ServerSnapshot.js';

// Пороги по умолчанию (код — источник правды в v1; per-project оверрайды — v3).
export const DEFAULT_DISK_USAGE_PCT = 90;
export const DEFAULT_DISK_CRITICAL_PCT = 95;
export const DEFAULT_RESTART_SPIKE = 5; // прирост рестартов между снимками
export const DEFAULT_SNAPSHOT_STALE_MINUTES = 15;
// Минимум между повторными уведомлениями по одному и тому же firing-алерту (анти-спам).
export const ALERT_RENOTIFY_MS = 6 * 60 * 60 * 1000; // 6 часов

// Разрешённое правило (после мерджа per-project оверрайдов с дефолтами).
export type ResolvedRule = {
  readonly enabled: boolean;
  readonly threshold: number | null;
  readonly severity: AlertSeverity;
};
export type AlertRuleConfig = Readonly<Record<AlertKind, ResolvedRule>>;

export const DEFAULT_RULE_CONFIG: AlertRuleConfig = {
  process_down: { enabled: true, threshold: null, severity: 'critical' },
  disk_usage: { enabled: true, threshold: DEFAULT_DISK_USAGE_PCT, severity: 'warning' },
  restart_spike: { enabled: true, threshold: DEFAULT_RESTART_SPIKE, severity: 'warning' },
  snapshot_stale: { enabled: true, threshold: DEFAULT_SNAPSHOT_STALE_MINUTES, severity: 'warning' },
};

// Мердж строк server_alert_rules (per-project) поверх дефолтов. Отсутствующие — дефолт.
export function resolveRuleConfig(
  overrides: ReadonlyArray<{
    ruleKind: string;
    enabled: boolean;
    threshold: number | null;
    severity?: AlertSeverity;
  }>,
): AlertRuleConfig {
  const cfg: Record<AlertKind, ResolvedRule> = {
    process_down: { ...DEFAULT_RULE_CONFIG.process_down },
    disk_usage: { ...DEFAULT_RULE_CONFIG.disk_usage },
    restart_spike: { ...DEFAULT_RULE_CONFIG.restart_spike },
    snapshot_stale: { ...DEFAULT_RULE_CONFIG.snapshot_stale },
  };
  for (const o of overrides) {
    if (o.ruleKind in cfg) {
      const k = o.ruleKind as AlertKind;
      cfg[k] = {
        enabled: o.enabled,
        threshold: o.threshold ?? DEFAULT_RULE_CONFIG[k].threshold,
        severity: o.severity ?? DEFAULT_RULE_CONFIG[k].severity,
      };
    }
  }
  return cfg;
}

// Условие, активное в текущем снимке. EvaluateAlerts сверяет набор условий с уже
// горящими алертами и решает что создать/потушить.
export type AlertCondition = {
  readonly ruleKind: AlertKind;
  readonly dedupKey: string;
  readonly severity: AlertSeverity;
  readonly message: string;
  readonly details: Record<string, unknown>;
};

function pct(n: number): string {
  return `${Math.round(n)}%`;
}

// Оценить «мгновенные» правила по свежему снимку (process_down, disk_usage) и
// «разностное» (restart_spike) против предыдущего снимка. snapshot_stale считается
// отдельным sweep'ом (нет свежего снимка — нечего оценивать тут).
export function evaluateSnapshotConditions(input: {
  readonly reachable: boolean;
  readonly metrics: SnapshotMetrics | null;
  readonly prevMetrics: SnapshotMetrics | null;
  readonly config?: AlertRuleConfig;
}): AlertCondition[] {
  const cfg = input.config ?? DEFAULT_RULE_CONFIG;
  const conditions: AlertCondition[] = [];
  // Недоступный сервер: процессы не проверить — поднимаем server-level process_down.
  if (!input.reachable || !input.metrics) {
    if (cfg.process_down.enabled) {
      conditions.push({
        ruleKind: 'process_down',
        dedupKey: '',
        severity: cfg.process_down.severity,
        message: 'Сервер недоступен — не удалось собрать метрики',
        details: { reachable: input.reachable },
      });
    }
    return conditions;
  }

  const diskThreshold = cfg.disk_usage.threshold ?? DEFAULT_DISK_USAGE_PCT;
  const restartSpike = cfg.restart_spike.threshold ?? DEFAULT_RESTART_SPIKE;

  // process_down: каждый не-online pm2-процесс.
  if (cfg.process_down.enabled)
    for (const p of input.metrics.pm2) {
    if (p.status !== 'online') {
      conditions.push({
        ruleKind: 'process_down',
        dedupKey: p.name,
        severity: cfg.process_down.severity,
        message: `pm2-процесс «${p.name}» не online (${p.status})`,
        details: { process: p.name, status: p.status, restarts: p.restarts },
      });
    }
  }

  // disk_usage: каждый раздел выше порога.
  if (cfg.disk_usage.enabled)
    for (const d of input.metrics.system?.disks ?? []) {
    if (d.usedPct >= diskThreshold) {
      const critical = d.usedPct >= DEFAULT_DISK_CRITICAL_PCT;
      conditions.push({
        ruleKind: 'disk_usage',
        dedupKey: d.mount,
        severity: critical ? 'critical' : cfg.disk_usage.severity,
        message: `Диск ${d.mount} заполнен на ${pct(d.usedPct)}`,
        details: { mount: d.mount, usedPct: d.usedPct },
      });
    }
  }

  // restart_spike: прирост рестартов относительно предыдущего снимка.
  if (cfg.restart_spike.enabled && input.prevMetrics) {
    const prevByName = new Map(input.prevMetrics.pm2.map((p) => [p.name, p.restarts ?? 0]));
    for (const p of input.metrics.pm2) {
      const prev = prevByName.get(p.name);
      if (prev === undefined) continue;
      const delta = (p.restarts ?? 0) - prev;
      if (delta >= restartSpike) {
        conditions.push({
          ruleKind: 'restart_spike',
          dedupKey: p.name,
          severity: cfg.restart_spike.severity,
          message: `pm2-процесс «${p.name}» перезапустился ${delta} раз(а) с прошлого снимка`,
          details: { process: p.name, delta, total: p.restarts },
        });
      }
    }
  }

  return conditions;
}

// Условие «снимок устарел» для server-level staleness sweep'а.
export function stalenessCondition(
  minutesStale: number,
  severity: AlertSeverity = 'warning',
): AlertCondition {
  return {
    ruleKind: 'snapshot_stale',
    dedupKey: '',
    severity,
    message: `Нет свежих метрик уже ${minutesStale} мин — сборщик молчит?`,
    details: { minutesStale },
  };
}
