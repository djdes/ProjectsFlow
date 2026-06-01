import type { ServerRepository } from './ServerRepository.js';
import type { ProjectServer } from '../../domain/monitoring/ProjectServer.js';

type Deps = {
  readonly servers: ServerRepository;
};

// Список remote-серверов для агента-сборщика. Не-admin видит только серверы своих
// проектов (мониторинг owner-only → ownerId = userId). admin видит все.
export class ListMonitoredServers {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string, isAdmin: boolean): Promise<ProjectServer[]> {
    return this.deps.servers.listEnabledRemoteByOwner(isAdmin ? null : userId);
  }
}
