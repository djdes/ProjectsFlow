import type { AlertKind, AlertSeverity } from './Alert.js';
import type { SnapshotMetrics } from './ServerSnapshot.js';

// Пороги по умолчанию (код — источник правды в v1; per-project оверрайды — v3).
export const DEFAULT_DISK_USAGE_PCT = 90;
export const DEFAULT_DISK_CRITICAL_PCT = 95;
export const DEFAULT_RESTART_SPIKE = 5; // прирост рестартов между снимками
export const DEFAULT_SNAPSHOT_STALE_MINUTES = 15;
// Минимум между повторными уведомлениями по одному и тому же firing-алерту (анти-спам).
export const ALERT_RENOTIFY_MS = 6 * 60 * 60 * 1000; // 6 часов

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
  readonly diskThresholdPct?: number;
  readonly restartSpike?: number;
}): AlertCondition[] {
  const conditions: AlertCondition[] = [];
  // Недоступный сервер: процессы не проверить — поднимаем server-level process_down.
  if (!input.reachable || !input.metrics) {
    conditions.push({
      ruleKind: 'process_down',
      dedupKey: '',
      severity: 'critical',
      message: 'Сервер недоступен — не удалось собрать метрики',
      details: { reachable: input.reachable },
    });
    return conditions;
  }

  const diskThreshold = input.diskThresholdPct ?? DEFAULT_DISK_USAGE_PCT;
  const restartSpike = input.restartSpike ?? DEFAULT_RESTART_SPIKE;

  // process_down: каждый не-online pm2-процесс.
  for (const p of input.metrics.pm2) {
    if (p.status !== 'online') {
      conditions.push({
        ruleKind: 'process_down',
        dedupKey: p.name,
        severity: 'critical',
        message: `pm2-процесс «${p.name}» не online (${p.status})`,
        details: { process: p.name, status: p.status, restarts: p.restarts },
      });
    }
  }

  // disk_usage: каждый раздел выше порога.
  for (const d of input.metrics.system?.disks ?? []) {
    if (d.usedPct >= diskThreshold) {
      const critical = d.usedPct >= DEFAULT_DISK_CRITICAL_PCT;
      conditions.push({
        ruleKind: 'disk_usage',
        dedupKey: d.mount,
        severity: critical ? 'critical' : 'warning',
        message: `Диск ${d.mount} заполнен на ${pct(d.usedPct)}`,
        details: { mount: d.mount, usedPct: d.usedPct },
      });
    }
  }

  // restart_spike: прирост рестартов относительно предыдущего снимка.
  if (input.prevMetrics) {
    const prevByName = new Map(input.prevMetrics.pm2.map((p) => [p.name, p.restarts ?? 0]));
    for (const p of input.metrics.pm2) {
      const prev = prevByName.get(p.name);
      if (prev === undefined) continue;
      const delta = (p.restarts ?? 0) - prev;
      if (delta >= restartSpike) {
        conditions.push({
          ruleKind: 'restart_spike',
          dedupKey: p.name,
          severity: 'warning',
          message: `pm2-процесс «${p.name}» перезапустился ${delta} раз(а) с прошлого снимка`,
          details: { process: p.name, delta, total: p.restarts },
        });
      }
    }
  }

  return conditions;
}

// Условие «снимок устарел» для server-level staleness sweep'а.
export function stalenessCondition(minutesStale: number): AlertCondition {
  return {
    ruleKind: 'snapshot_stale',
    dedupKey: '',
    severity: 'warning',
    message: `Нет свежих метрик уже ${minutesStale} мин — сборщик молчит?`,
    details: { minutesStale },
  };
}
