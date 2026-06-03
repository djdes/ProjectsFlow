export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus = 'firing' | 'resolved';
export type AlertRuleKind =
  | 'process_down'
  | 'disk_usage'
  | 'restart_spike'
  | 'snapshot_stale'
  | 'http_down'
  | 'ssl_expiry';

export type AlertRule = {
  readonly ruleKind: AlertRuleKind;
  readonly enabled: boolean;
  readonly threshold: number | null;
  readonly severity: AlertSeverity;
};

export type ServerAlert = {
  readonly id: string;
  readonly serverId: string;
  readonly projectId: string;
  readonly ruleKind: string;
  readonly dedupKey: string;
  readonly severity: AlertSeverity;
  readonly status: AlertStatus;
  readonly message: string;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly resolvedAt: Date | null;
};

// Запись кросс-проектного Alert Center (алерт + имена проекта/сервера).
export type AlertCenterEntry = {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly serverId: string;
  readonly serverName: string | null;
  readonly ruleKind: string;
  readonly severity: AlertSeverity;
  readonly status: AlertStatus;
  readonly message: string;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly resolvedAt: Date | null;
};

export type AlertCenter = {
  readonly active: AlertCenterEntry[];
  readonly recent: AlertCenterEntry[];
};
