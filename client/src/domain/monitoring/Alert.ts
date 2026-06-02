export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus = 'firing' | 'resolved';
export type AlertRuleKind = 'process_down' | 'disk_usage' | 'restart_spike' | 'snapshot_stale';

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
