export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus = 'firing' | 'resolved';

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
