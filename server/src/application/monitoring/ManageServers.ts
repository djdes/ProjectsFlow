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

// SSRF-защита: бэкенд сам ходит по health_url с прод-VPS, поэтому цель задаёт editor.
// Блокируем loopback / private / link-local / metadata-хосты и нестандартные порты,
// чтобы health-проверку нельзя было превратить в зонд внутренней сети (169.254.169.254,
// 127.0.0.1:4317 — сам бэкенд, RFC1918 LAN). Проверка на этапе записи; остаточный риск
// DNS-rebind (TOCTOU) для FQDN считаем приемлемым в v1.
function isBlockedHost(rawHost: string): boolean {
  // IPv6-литерал в URL.hostname приходит в скобках — снимаем их.
  const host = rawHost.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  // IPv4-литерал.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some((n) => n > 255)) return true; // мусорный литерал — блокируем
    const [a, b] = o as [number, number, number, number];
    if (a === 0 || a === 127 || a === 10) return true; // 0/8, loopback, private
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    return false;
  }

  // IPv6-литерал (включая IPv4-mapped ::ffff:a.b.c.d).
  if (host.includes(':')) {
    if (host === '::1' || host === '::') return true; // loopback / unspecified
    if (host.startsWith('fc') || host.startsWith('fd')) return true; // ULA fc00::/7
    if (/^fe[89ab]/.test(host)) return true; // link-local fe80::/10
    const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host);
    if (mapped) return isBlockedHost(mapped[1] as string);
    return false;
  }

  return false;
}

function validateHealthUrl(url: string | null | undefined): string | null {
  if (url === null || url === undefined || url.trim() === '') return null;
  const u = url.trim();
  if (u.length > 500) throw new ServerNameInvalidError('health_url: слишком длинный');
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    throw new ServerNameInvalidError('health_url: некорректный URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ServerNameInvalidError('health_url: нужен http(s):// URL');
  }
  // Только стандартные веб-порты — иначе health-проба превращается в порт-сканер.
  if (parsed.port !== '' && parsed.port !== '80' && parsed.port !== '443') {
    throw new ServerNameInvalidError('health_url: допустимы только порты 80 и 443');
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new ServerNameInvalidError('health_url: внутренние/приватные адреса запрещены');
  }
  return u;
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
      healthUrl: validateHealthUrl(input.healthUrl),
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
      healthUrl: validateHealthUrl(patch.healthUrl),
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

  // «Тихий час»: заглушить уведомления по серверу на N минут (null = снять заглушку).
  async setMute(
    projectId: string,
    serverId: string,
    userId: string,
    minutes: number | null,
  ): Promise<ProjectServer> {
    await requireProjectAccess(this.deps, projectId, userId, 'manage_monitoring');
    await this.ensureServer(projectId, serverId);
    const mutedUntil =
      minutes && minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null;
    const updated = await this.deps.servers.update(serverId, { mutedUntil });
    if (!updated) throw new ServerNotFoundError();
    return updated;
  }

  private async ensureServer(projectId: string, serverId: string): Promise<ProjectServer> {
    const server = await this.deps.servers.getById(serverId);
    if (!server || server.projectId !== projectId) throw new ServerNotFoundError();
    return server;
  }
}
