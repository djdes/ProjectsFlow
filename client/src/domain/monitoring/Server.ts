import type { ServerHealthStatus, ServerSnapshot } from './Snapshot';

export type ServerKind = 'local' | 'remote';

export type MonitoringServer = {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly kind: ServerKind;
  readonly host: string | null;
  readonly sshPort: number;
  readonly sshUser: string | null;
  readonly sshCredentialRef: string | null;
  readonly pm2ProcessNames: ReadonlyArray<string> | null;
  readonly nginxAccessLogPath: string | null;
  readonly nginxErrorLogPath: string | null;
  readonly deployPath: string | null;
  readonly healthUrl: string | null;
  readonly enabled: boolean;
  readonly collectIntervalSeconds: number;
  readonly lastSnapshotAt: Date | null;
  readonly lastStatus: ServerHealthStatus | null;
  readonly mutedUntil: Date | null;
};

export type ServerWithLatest = {
  readonly server: MonitoringServer;
  readonly latest: ServerSnapshot | null;
};

// Сводка «здоровье всех проектов».
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
};

// Поля, которые форма отправляет на сервер при создании/редактировании.
export type ServerConfigInput = {
  readonly name: string;
  readonly kind: ServerKind;
  readonly host?: string | null;
  readonly sshPort?: number;
  readonly sshUser?: string | null;
  readonly sshCredentialRef?: string | null;
  readonly pm2ProcessNames?: string[] | null;
  readonly nginxAccessLogPath?: string | null;
  readonly nginxErrorLogPath?: string | null;
  readonly deployPath?: string | null;
  readonly healthUrl?: string | null;
  readonly enabled?: boolean;
  readonly collectIntervalSeconds?: number;
};
