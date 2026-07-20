import type { LiveSession } from '../../domain/live/LiveSession.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { AgentTokenRepository } from './AgentTokenRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly agentTokens: AgentTokenRepository;
  readonly live: {
    listRecentProjectSessions(projectId: string, limit: number): Promise<LiveSession[]>;
    countRunningProjectSessions(projectId: string): Promise<number>;
  };
  readonly now?: () => Date;
};

// Один прогон воркера (LIVE-сессия) в проекции для карточки. Плательщик (billedUserId)
// НЕ отдаётся — это внутренняя атрибуция биллинга, а не свойство прогона.
export type ProjectWorkerRun = {
  readonly id: string;
  readonly taskId: string;
  readonly agentName: string | null;
  readonly attempt: number;
  readonly status: LiveSession['status'];
  readonly model: string | null;
  readonly costUsd: number | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly eventCount: number;
  readonly startedAt: string;
  readonly endedAt: string | null;
};

// Сводка по активным capabilities воркера (project-scoped child-токены, db/126).
// Префиксы/хеши токенов НЕ раскрываем — только счётчики и ближайший срок истечения.
export type ProjectWorkerCapabilities = {
  // Всего активных project-scoped токенов проекта.
  readonly active: number;
  // Из них привязаны к конкретной задаче (taskId != null) и к проекту целиком.
  readonly taskScoped: number;
  readonly projectScoped: number;
  // Ближайший срок истечения (ISO) среди активных — null если у всех бессрочно.
  readonly nextExpiryAt: string | null;
};

export type ProjectWorkerOverview = {
  // Есть ли назначенный диспетчер и включена ли параллельность (дублируем из проекта,
  // чтобы карточка не зависела от свежести объекта проекта на клиенте).
  readonly dispatcherUserId: string | null;
  readonly multiTaskWorker: boolean;
  // Сейчас идёт хотя бы один прогон.
  readonly runningCount: number;
  readonly capabilities: ProjectWorkerCapabilities;
  readonly recentRuns: readonly ProjectWorkerRun[];
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function toRun(s: LiveSession): ProjectWorkerRun {
  return {
    id: s.id,
    taskId: s.taskId,
    agentName: s.agentName,
    attempt: s.attempt,
    status: s.status,
    model: s.model,
    costUsd: s.costUsd,
    tokensIn: s.tokensIn,
    tokensOut: s.tokensOut,
    eventCount: s.eventCount,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
  };
}

// Карточка воркера в разделе Agents: диспетчер + режим параллельности + активные
// capabilities + история прогонов. read_project (member+; admin — bypass).
export class GetProjectWorkerOverview {
  constructor(private readonly deps: Deps) {}

  async execute(
    projectId: string,
    actorUserId: string,
    limit = DEFAULT_LIMIT,
  ): Promise<ProjectWorkerOverview> {
    const { project } = await requireProjectAccess(
      this.deps,
      projectId,
      actorUserId,
      'read_project',
    );

    const cappedLimit = Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit) || DEFAULT_LIMIT));
    const [sessions, runningCount, caps] = await Promise.all([
      this.deps.live.listRecentProjectSessions(projectId, cappedLimit),
      this.deps.live.countRunningProjectSessions(projectId),
      this.deps.agentTokens.listActiveProjectCapabilities(projectId),
    ]);

    let taskScoped = 0;
    let nextExpiry: Date | null = null;
    for (const c of caps) {
      if (c.taskId) taskScoped += 1;
      if (c.expiresAt && (nextExpiry === null || c.expiresAt < nextExpiry)) {
        nextExpiry = c.expiresAt;
      }
    }

    return {
      dispatcherUserId: project.dispatcherUserId,
      multiTaskWorker: project.multiTaskWorker,
      runningCount,
      capabilities: {
        active: caps.length,
        taskScoped,
        projectScoped: caps.length - taskScoped,
        nextExpiryAt: nextExpiry ? nextExpiry.toISOString() : null,
      },
      recentRuns: sessions.map(toRun),
    };
  }
}
