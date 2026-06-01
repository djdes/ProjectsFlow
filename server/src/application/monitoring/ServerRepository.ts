import type { ProjectServer, ServerKind } from '../../domain/monitoring/ProjectServer.js';
import type { ServerHealthStatus } from '../../domain/monitoring/ServerSnapshot.js';

export type NewServerInput = {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly kind: ServerKind;
  readonly host: string | null;
  readonly sshPort: number;
  readonly sshUser: string | null;
  readonly sshCredentialRef: string | null;
  readonly pm2ProcessNames: string[] | null;
  readonly nginxAccessLogPath: string | null;
  readonly nginxErrorLogPath: string | null;
  readonly deployPath: string | null;
  readonly enabled: boolean;
  readonly collectIntervalSeconds: number;
};

export type UpdateServerPatch = Partial<Omit<NewServerInput, 'id' | 'projectId'>>;

export interface ServerRepository {
  listByProject(projectId: string): Promise<ProjectServer[]>;
  getById(serverId: string): Promise<ProjectServer | null>;
  getLocalForProject(projectId: string): Promise<ProjectServer | null>;
  findByName(projectId: string, name: string): Promise<ProjectServer | null>;
  // Все enabled-серверы (оба kind) — для staleness-sweep и KB-снимков.
  listEnabled(): Promise<ProjectServer[]>;
  // Enabled-серверы конкретного kind — local-collect интервал берёт 'local'.
  listEnabledByKind(kind: ServerKind): Promise<ProjectServer[]>;
  // Enabled remote-серверы для агента-сборщика. ownerId=null → все (admin).
  listEnabledRemoteByOwner(ownerId: string | null): Promise<ProjectServer[]>;
  create(input: NewServerInput): Promise<ProjectServer>;
  update(serverId: string, patch: UpdateServerPatch): Promise<ProjectServer | null>;
  delete(serverId: string): Promise<void>;
  updateLastSnapshot(serverId: string, at: Date, status: ServerHealthStatus): Promise<void>;
}
