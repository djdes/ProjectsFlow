export type AlertKind =
  | 'disk_usage'
  | 'process_down'
  | 'restart_spike'
  | 'snapshot_stale'
  | 'http_down'
  | 'ssl_expiry'
  // Аномалия метрики (адаптивный baseline, sweep — не per-snapshot). См. domain/monitoring/anomaly.ts.
  | 'metric_anomaly';
export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus = 'firing' | 'resolved';

export type AlertRule = {
  readonly projectId: string;
  readonly ruleKind: AlertKind;
  readonly enabled: boolean;
  readonly threshold: number | null;
  readonly severity: AlertSeverity;
};

export type ServerAlert = {
  readonly id: string;
  readonly serverId: string;
  readonly projectId: string;
  readonly ruleKind: AlertKind;
  // Ключ дедупа внутри правила (имя pm2-процесса, mount диска или '' для server-level).
  readonly dedupKey: string;
  readonly severity: AlertSeverity;
  readonly status: AlertStatus;
  readonly message: string; // RU, человекочитаемое
  readonly details: Record<string, unknown> | null;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly resolvedAt: Date | null;
  readonly lastNotifiedAt: Date | null;
  readonly createdAt: Date;
};
