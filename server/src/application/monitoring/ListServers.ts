import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { ServerRepository } from './ServerRepository.js';
import type { SnapshotRepository } from './SnapshotRepository.js';
import type { ProjectServer } from '../../domain/monitoring/ProjectServer.js';
import type { ServerSnapshot } from '../../domain/monitoring/ServerSnapshot.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly servers: ServerRepository;
  readonly snapshots: SnapshotRepository;
};

export type ServerWithLatest = {
  readonly server: ProjectServer;
  readonly latest: ServerSnapshot | null;
};

export class ListServers {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, userId: string): Promise<ServerWithLatest[]> {
    await requireProjectAccess(this.deps, projectId, userId, 'view_monitoring');
    const servers = await this.deps.servers.listByProject(projectId);
    const latestByServer = await this.deps.snapshots.listLatestPerServer(projectId);
    return servers.map((server) => ({
      server,
      latest: latestByServer.get(server.id) ?? null,
    }));
  }
}
