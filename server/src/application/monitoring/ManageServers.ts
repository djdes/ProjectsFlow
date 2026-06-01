import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { InMemoryRateLimiter } from '../../infrastructure/ratelimit/InMemoryRateLimiter.js';
import type { ServerRepository, UpdateServerPatch } from './ServerRepository.js';
import type { CollectLocalSnapshot } from './CollectLocalSnapshot.js';
import type { ProjectServer, ServerConfigInput } from '../../domain/monitoring/ProjectServer.js';
import type { ServerSnapshot } from '../../domain/monitoring/ServerSnapshot.js';
import {
  NotLocalServerError,
  ServerNameInvalidError,
  ServerNotFoundError,
} from '../../domain/monitoring/errors.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly servers: ServerRepository;
  readonly idGen: () => string;
  readonly collectLocal: CollectLocalSnapshot;
  readonly rateLimiter: InMemoryRateLimiter;
};

// Абсолютный путь без traversal/NUL/control-символов. Defense-in-depth — сам collector
// дополнительно проверяет allowlist при чтении.
function validatePath(path: string | null | undefined, field: string): string | null {
  if (path === null || path === undefined || path === '') return null;
  if (path.length > 500) throw new ServerNameInvalidError(`${field}: путь слишком длинный`);
  for (let i = 0; i < path.length; i += 1) {
    if (path.charCodeAt(i) < 0x20) throw new ServerNameInvalidError(`${field}: недопустимые символы`);
  }
  if (path.includes('..')) throw new ServerNameInvalidError(`${field}: '..' запрещён`);
  if (!path.startsWith('/')) throw new ServerNameInvalidError(`${field}: нужен абсолютный путь`);
  return path;
}

function validateName(name: string): string {
  const n = name.trim();
  if (n.length === 0 || n.length > 120) throw new ServerNameInvalidError();
  return n;
}

export class ManageServers {
  constructor(private readonly deps: Deps) {}

  async create(projectId: string, userId: string, input: ServerConfigInput): Promise<ProjectServer> {
    await requireProjectAccess(this.deps, projectId, userId, 'manage_monitoring');
    const name = validateName(input.name);

    if (input.kind === 'local') {
      const existing = await this.deps.servers.getLocalForProject(projectId);
      if (existing) throw new ServerNameInvalidError('У проекта уже есть local-сервер');
    }

    return this.deps.servers.create({
      id: this.deps.idGen(),
      projectId,
      name,
      kind: input.kind,
      host: input.host ?? null,
      sshPort: input.sshPort ?? 22,
      sshUser: input.sshUser ?? null,
      sshCredentialRef: input.sshCredentialRef ?? null,
      pm2ProcessNames: input.pm2ProcessNames ? [...input.pm2ProcessNames] : null,
      nginxAccessLogPath: validatePath(input.nginxAccessLogPath, 'nginx_access_log_path'),
      nginxErrorLogPath: validatePath(input.nginxErrorLogPath, 'nginx_error_log_path'),
      deployPath: validatePath(input.deployPath, 'deploy_path'),
      enabled: input.enabled ?? true,
      collectIntervalSeconds: input.collectIntervalSeconds ?? 300,
    });
  }

  async update(
    projectId: string,
    serverId: string,
    userId: string,
    patch: ServerConfigInput,
  ): Promise<ProjectServer> {
    await requireProjectAccess(this.deps, projectId, userId, 'manage_monitoring');
    await this.ensureServer(projectId, serverId);

    const next: UpdateServerPatch = {
      name: validateName(patch.name),
      host: patch.host ?? null,
      sshPort: patch.sshPort ?? 22,
      sshUser: patch.sshUser ?? null,
      sshCredentialRef: patch.sshCredentialRef ?? null,
      pm2ProcessNames: patch.pm2ProcessNames ? [...patch.pm2ProcessNames] : null,
      nginxAccessLogPath: validatePath(patch.nginxAccessLogPath, 'nginx_access_log_path'),
      nginxErrorLogPath: validatePath(patch.nginxErrorLogPath, 'nginx_error_log_path'),
      deployPath: validatePath(patch.deployPath, 'deploy_path'),
      enabled: patch.enabled ?? true,
      collectIntervalSeconds: patch.collectIntervalSeconds ?? 300,
    };
    const updated = await this.deps.servers.update(serverId, next);
    if (!updated) throw new ServerNotFoundError();
    return updated;
  }

  async remove(projectId: string, serverId: string, userId: string): Promise<void> {
    await requireProjectAccess(this.deps, projectId, userId, 'manage_monitoring');
    await this.ensureServer(projectId, serverId);
    await this.deps.servers.delete(serverId);
  }

  // On-demand сбор для local-сервера. Rate-limit на юзера (анти-DoS shell-out).
  async triggerLocalCollect(
    projectId: string,
    serverId: string,
    userId: string,
  ): Promise<ServerSnapshot> {
    await requireProjectAccess(this.deps, projectId, userId, 'manage_monitoring');
    const server = await this.ensureServer(projectId, serverId);
    if (server.kind !== 'local') throw new NotLocalServerError();
    if (!this.deps.rateLimiter.hit(`monitoring-collect:${userId}`, 20, 60_000)) {
      throw new ServerNameInvalidError('Слишком часто — попробуйте через минуту');
    }
    return this.deps.collectLocal.collect(server, { force: true });
  }

  private async ensureServer(projectId: string, serverId: string): Promise<ProjectServer> {
    const server = await this.deps.servers.getById(serverId);
    if (!server || server.projectId !== projectId) throw new ServerNotFoundError();
    return server;
  }
}
