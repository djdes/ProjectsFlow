import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { projects, projectServers, type ProjectServerRow } from '../db/schema.js';
import type {
  NewServerInput,
  ServerRepository,
  UpdateServerPatch,
} from '../../application/monitoring/ServerRepository.js';
import type { ProjectServer, ServerKind } from '../../domain/monitoring/ProjectServer.js';
import type { ServerHealthStatus } from '../../domain/monitoring/ServerSnapshot.js';
import { parseJsonCol } from './jsonCol.js';

function toServer(r: ProjectServerRow): ProjectServer {
  return {
    id: r.id,
    projectId: r.projectId,
    name: r.name,
    kind: r.kind,
    host: r.host ?? null,
    sshPort: r.sshPort,
    sshUser: r.sshUser ?? null,
    sshCredentialRef: r.sshCredentialRef ?? null,
    pm2ProcessNames: parseJsonCol<string[] | null>(r.pm2ProcessNames, null),
    nginxAccessLogPath: r.nginxAccessLogPath ?? null,
    nginxErrorLogPath: r.nginxErrorLogPath ?? null,
    deployPath: r.deployPath ?? null,
    enabled: r.enabled,
    collectIntervalSeconds: r.collectIntervalSeconds,
    lastSnapshotAt: r.lastSnapshotAt ?? null,
    lastStatus: (r.lastStatus as ServerHealthStatus | null) ?? null,
    mutedUntil: r.mutedUntil ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export class DrizzleServerRepository implements ServerRepository {
  constructor(private readonly db: Database) {}

  async listByProject(projectId: string): Promise<ProjectServer[]> {
    const rows = await this.db
      .select()
      .from(projectServers)
      .where(eq(projectServers.projectId, projectId));
    return rows.map(toServer);
  }

  async getById(serverId: string): Promise<ProjectServer | null> {
    const [row] = await this.db
      .select()
      .from(projectServers)
      .where(eq(projectServers.id, serverId))
      .limit(1);
    return row ? toServer(row) : null;
  }

  async getLocalForProject(projectId: string): Promise<ProjectServer | null> {
    const [row] = await this.db
      .select()
      .from(projectServers)
      .where(and(eq(projectServers.projectId, projectId), eq(projectServers.kind, 'local')))
      .limit(1);
    return row ? toServer(row) : null;
  }

  async findByName(projectId: string, name: string): Promise<ProjectServer | null> {
    const [row] = await this.db
      .select()
      .from(projectServers)
      .where(and(eq(projectServers.projectId, projectId), eq(projectServers.name, name)))
      .limit(1);
    return row ? toServer(row) : null;
  }

  async listEnabled(): Promise<ProjectServer[]> {
    const rows = await this.db
      .select()
      .from(projectServers)
      .where(eq(projectServers.enabled, true));
    return rows.map(toServer);
  }

  async listEnabledByKind(kind: ServerKind): Promise<ProjectServer[]> {
    const rows = await this.db
      .select()
      .from(projectServers)
      .where(and(eq(projectServers.kind, kind), eq(projectServers.enabled, true)));
    return rows.map(toServer);
  }

  async listEnabledRemoteByOwner(ownerId: string | null): Promise<ProjectServer[]> {
    const base = and(
      eq(projectServers.kind, 'remote'),
      eq(projectServers.enabled, true),
    );
    const rows = await this.db
      .select({ s: projectServers })
      .from(projectServers)
      .innerJoin(projects, eq(projects.id, projectServers.projectId))
      .where(ownerId === null ? base : and(base, eq(projects.ownerId, ownerId)));
    return rows.map((r) => toServer(r.s));
  }

  async create(input: NewServerInput): Promise<ProjectServer> {
    await this.db.insert(projectServers).values({
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      kind: input.kind,
      host: input.host,
      sshPort: input.sshPort,
      sshUser: input.sshUser,
      sshCredentialRef: input.sshCredentialRef,
      pm2ProcessNames: input.pm2ProcessNames,
      nginxAccessLogPath: input.nginxAccessLogPath,
      nginxErrorLogPath: input.nginxErrorLogPath,
      deployPath: input.deployPath,
      enabled: input.enabled,
      collectIntervalSeconds: input.collectIntervalSeconds,
    });
    const created = await this.getById(input.id);
    if (!created) throw new Error(`project_servers row ${input.id} disappeared after insert`);
    return created;
  }

  async update(serverId: string, patch: UpdateServerPatch): Promise<ProjectServer | null> {
    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) set['name'] = patch.name;
    if (patch.kind !== undefined) set['kind'] = patch.kind;
    if (patch.host !== undefined) set['host'] = patch.host;
    if (patch.sshPort !== undefined) set['sshPort'] = patch.sshPort;
    if (patch.sshUser !== undefined) set['sshUser'] = patch.sshUser;
    if (patch.sshCredentialRef !== undefined) set['sshCredentialRef'] = patch.sshCredentialRef;
    if (patch.pm2ProcessNames !== undefined) set['pm2ProcessNames'] = patch.pm2ProcessNames;
    if (patch.nginxAccessLogPath !== undefined) set['nginxAccessLogPath'] = patch.nginxAccessLogPath;
    if (patch.nginxErrorLogPath !== undefined) set['nginxErrorLogPath'] = patch.nginxErrorLogPath;
    if (patch.deployPath !== undefined) set['deployPath'] = patch.deployPath;
    if (patch.enabled !== undefined) set['enabled'] = patch.enabled;
    if (patch.collectIntervalSeconds !== undefined) {
      set['collectIntervalSeconds'] = patch.collectIntervalSeconds;
    }
    if (patch.mutedUntil !== undefined) set['mutedUntil'] = patch.mutedUntil;
    if (Object.keys(set).length > 0) {
      await this.db.update(projectServers).set(set).where(eq(projectServers.id, serverId));
    }
    return this.getById(serverId);
  }

  async delete(serverId: string): Promise<void> {
    await this.db.delete(projectServers).where(eq(projectServers.id, serverId));
  }

  async updateLastSnapshot(serverId: string, at: Date, status: ServerHealthStatus): Promise<void> {
    await this.db
      .update(projectServers)
      .set({ lastSnapshotAt: at, lastStatus: status, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(projectServers.id, serverId));
  }
}
