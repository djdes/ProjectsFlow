import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { ServerRepository } from './ServerRepository.js';
import type { SnapshotRepository } from './SnapshotRepository.js';
import { redactLogTails } from './CollectLocalSnapshot.js';
import {
  computeServerStatus,
  type DbHealth,
  type LogTails,
  type ServerSnapshot,
  type SnapshotMetrics,
} from '../../domain/monitoring/ServerSnapshot.js';
import type { ProjectServer } from '../../domain/monitoring/ProjectServer.js';
import { SnapshotIngestInvalidError } from '../../domain/monitoring/errors.js';

type SnapshotStoredHook = (snapshot: ServerSnapshot, prev: ServerSnapshot | null) => void;

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly servers: ServerRepository;
  readonly snapshots: SnapshotRepository;
  readonly idGen: () => string;
  readonly now: () => Date;
  readonly onSnapshotStored?: SnapshotStoredHook;
};

export type IngestAgentSnapshotInput = {
  readonly projectId: string;
  readonly userId: string;
  readonly agentTokenId: string | null;
  readonly serverName: string;
  readonly collectedAt: Date;
  readonly reachable: boolean;
  readonly metrics: SnapshotMetrics | null;
  readonly logs: LogTails | null;
  readonly dbHealth: DbHealth | null;
  readonly errors: string[] | null;
};

const FUTURE_SKEW_MS = 5 * 60 * 1000; // допускаем ±5 мин рассинхрон часов

// Приём снимка от агента-сборщика (Bearer agent-token). Гейт manage_monitoring (owner)
// ограничивает украденный токен проектами его владельца. Авто-создаёт remote-сервер при
// первом пуше (zero-config сборщик).
export class IngestAgentSnapshot {
  constructor(private readonly deps: Deps) {}

  async execute(input: IngestAgentSnapshotInput): Promise<{ snapshot: ServerSnapshot; server: ProjectServer }> {
    await requireProjectAccess(this.deps, input.projectId, input.userId, 'manage_monitoring');

    const nowMs = this.deps.now().getTime();
    if (input.collectedAt.getTime() > nowMs + FUTURE_SKEW_MS) {
      throw new SnapshotIngestInvalidError('collectedAt is in the future');
    }

    const name = input.serverName.trim();
    if (name.length === 0 || name.length > 120) {
      throw new SnapshotIngestInvalidError('serverName invalid');
    }

    // Резолвим/создаём remote-сервер по (projectId, name).
    let server = await this.deps.servers.findByName(input.projectId, name);
    if (!server) {
      server = await this.deps.servers.create({
        id: this.deps.idGen(),
        projectId: input.projectId,
        name,
        kind: 'remote',
        host: null,
        sshPort: 22,
        sshUser: null,
        sshCredentialRef: null,
        pm2ProcessNames: null,
        nginxAccessLogPath: null,
        nginxErrorLogPath: null,
        deployPath: null,
        healthUrl: null,
        enabled: true,
        collectIntervalSeconds: 300,
      });
    } else if (server.kind === 'local') {
      // local собирается бэкендом напрямую — агент не должен пушить под этим именем.
      throw new SnapshotIngestInvalidError('server is local; agent push not allowed');
    }

    // Анти-реплей / монотонность: новый снимок строго позже последнего.
    const latest = await this.deps.snapshots.getLatest(server.id);
    if (latest && input.collectedAt.getTime() <= latest.collectedAt.getTime()) {
      throw new SnapshotIngestInvalidError('non-monotonic collectedAt');
    }

    const status = computeServerStatus(input.reachable, input.metrics);
    const prev = await this.deps.snapshots.getLatestBefore(server.id, input.collectedAt);

    const snapshot = await this.deps.snapshots.insert({
      id: this.deps.idGen(),
      serverId: server.id,
      projectId: input.projectId,
      collectedAt: input.collectedAt,
      source: 'agent',
      status,
      reachable: input.reachable,
      metrics: input.metrics,
      logs: redactLogTails(input.logs),
      dbHealth: input.dbHealth,
      errors: input.errors && input.errors.length > 0 ? input.errors : null,
      pushedByUserId: input.userId,
      agentTokenId: input.agentTokenId,
    });

    await this.deps.servers.updateLastSnapshot(server.id, input.collectedAt, status);
    this.deps.onSnapshotStored?.(snapshot, prev);
    return { snapshot, server };
  }
}
