import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import { requireProjectAccess, requireDispatcherAccess } from '../project/projectAccess.js';
import type { ProjectEventBroadcaster } from '../realtime/ProjectEventBroadcaster.js';
import type { LiveRepository, FinishLiveSessionInput } from './LiveRepository.js';
import type { LiveEventHub } from '../../infrastructure/realtime/LiveEventHub.js';
import type { LiveSession, LiveSessionFinalStatus } from '../../domain/live/LiveSession.js';
import type { LiveEvent, LiveEventInput } from '../../domain/live/LiveEvent.js';
import type { LiveFileDiff, LiveFileChange } from '../../domain/live/LiveFileDiff.js';
import { LiveSessionNotFoundError } from '../../domain/live/errors.js';
import type { RecordUsage } from '../usage/RecordUsage.js';
import { assertBudgetAllowed, type CheckBudget } from '../usage/CheckBudget.js';

export type LiveServiceDeps = {
  readonly repo: LiveRepository;
  // projects/members — для requireProjectAccess / requireDispatcherAccess (тот же приём,
  // что в FileSyncService.accessDeps).
  readonly access: {
    readonly projects: ProjectRepository;
    readonly members: ProjectMemberRepository;
  };
  readonly broadcaster: ProjectEventBroadcaster;
  // Firehose live-событий для открытых SSE-вкладок (task-scoped, не per-user bus).
  readonly liveEventHub: LiveEventHub;
  readonly idGen: () => string;
  // Метеринг расхода ИИ: списываем с подписки диспетчера. Best-effort, не валит завершение.
  readonly recordUsage?: RecordUsage;
  // Гейт лимитов: подписка диспетчера исчерпала окно → старт сессии запрещён.
  readonly checkBudget?: CheckBudget;
  // TTL retention сессии (lazy-GC по expires_at). default 30 дней.
  readonly sessionTtlSeconds?: number;
};

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 дней

export type StartSessionInput = {
  readonly agentName: string;
  readonly attempt?: number;
  readonly model?: string | null;
  readonly headBefore?: string | null;
};

export type FinishSessionDiffInput = {
  readonly path: string;
  readonly change: LiveFileChange;
  readonly additions: number;
  readonly deletions: number;
  readonly unifiedDiff?: string | null;
  readonly isBinary?: boolean;
  readonly truncated?: boolean;
};

export class LiveService {
  constructor(private readonly deps: LiveServiceDeps) {}

  private get accessDeps() {
    return { projects: this.deps.access.projects, members: this.deps.access.members };
  }

  private async authDispatcher(projectId: string, userId: string): Promise<void> {
    await requireDispatcherAccess(this.accessDeps, projectId, userId);
  }

  private async authRead(projectId: string, userId: string): Promise<void> {
    await requireProjectAccess(this.accessDeps, projectId, userId, 'read_project');
  }

  private broadcastChanged(
    projectId: string,
    taskId: string,
    sessionId: string,
    status: LiveSession['status'],
  ): void {
    // Best-effort: ошибка резолва участников не должна валить запрос.
    void this.deps.broadcaster
      .broadcastLiveSessionChanged(projectId, taskId, sessionId, status)
      .catch(() => {});
  }

  // ---------- ingest (диспетчер/админ) ----------
  async startSession(
    projectId: string,
    userId: string,
    taskId: string,
    input: StartSessionInput,
  ): Promise<{ sessionId: string; baseSeq: number }> {
    await this.authDispatcher(projectId, userId);
    await assertBudgetAllowed(this.deps.checkBudget, userId);
    const sessionId = this.deps.idGen();
    const baseSeq = (await this.deps.repo.maxSeqForTask(taskId)) + 1;
    await this.deps.repo.insertSession({
      id: sessionId,
      projectId,
      taskId,
      agentName: input.agentName,
      attempt: input.attempt ?? 1,
      model: input.model ?? null,
      headBefore: input.headBefore ?? null,
      baseSeq,
      ttlSeconds: this.deps.sessionTtlSeconds ?? DEFAULT_TTL_SECONDS,
    });
    this.broadcastChanged(projectId, taskId, sessionId, 'running');
    return { sessionId, baseSeq };
  }

  async appendEvents(
    projectId: string,
    userId: string,
    taskId: string,
    sessionId: string,
    events: readonly LiveEventInput[],
  ): Promise<{ appended: number }> {
    await this.authDispatcher(projectId, userId);
    const session = await this.deps.repo.getSession(sessionId);
    if (!session || session.taskId !== taskId || session.projectId !== projectId) {
      throw new LiveSessionNotFoundError(sessionId);
    }

    let appended = 0;
    let maxSeq = session.lastSeq;
    const persisted: LiveEvent[] = [];
    for (const ev of events) {
      const ok = await this.deps.repo.appendEvent({
        sessionId,
        taskId,
        projectId,
        event: ev,
      });
      if (ok) {
        appended++;
        if (ev.seq > maxSeq) maxSeq = ev.seq;
        persisted.push({
          seq: ev.seq,
          kind: ev.kind,
          text: ev.text ?? null,
          payload: ev.payload ?? null,
          createdAt: new Date(),
        });
      }
    }

    if (appended > 0) {
      await this.deps.repo.bumpSession(sessionId, maxSeq, session.eventCount + appended);
      // Firehose в открытые вкладки. Только реально записанные (не дубли).
      this.deps.liveEventHub.publish(taskId, persisted);
    }
    return { appended };
  }

  async finishSession(
    projectId: string,
    userId: string,
    taskId: string,
    sessionId: string,
    input: FinishLiveSessionInput & { fileDiffs?: readonly FinishSessionDiffInput[] },
  ): Promise<{ ok: true }> {
    await this.authDispatcher(projectId, userId);
    const session = await this.deps.repo.getSession(sessionId);
    if (!session || session.taskId !== taskId || session.projectId !== projectId) {
      throw new LiveSessionNotFoundError(sessionId);
    }

    // Финальные git-диффы → события (kind='file_diff') + одно diff_summary. Продолжаем
    // нумерацию seq с курсора сессии.
    const diffs = input.fileDiffs ?? [];
    if (diffs.length > 0) {
      let seq = session.lastSeq;
      const persisted: LiveEvent[] = [];
      for (const d of diffs) {
        seq += 1;
        const payload = {
          path: d.path,
          change: d.change,
          additions: d.additions,
          deletions: d.deletions,
          unifiedDiff: d.unifiedDiff ?? null,
          isBinary: d.isBinary ?? false,
          truncated: d.truncated ?? false,
        };
        const ok = await this.deps.repo.appendEvent({
          sessionId,
          taskId,
          projectId,
          event: { seq, kind: 'file_diff', text: null, payload },
        });
        if (ok) {
          persisted.push({ seq, kind: 'file_diff', text: null, payload, createdAt: new Date() });
        }
      }
      seq += 1;
      const summaryPayload = {
        files: diffs.map((d) => ({
          path: d.path,
          change: d.change,
          additions: d.additions,
          deletions: d.deletions,
        })),
      };
      const summaryOk = await this.deps.repo.appendEvent({
        sessionId,
        taskId,
        projectId,
        event: { seq, kind: 'diff_summary', text: null, payload: summaryPayload },
      });
      if (summaryOk) {
        persisted.push({
          seq,
          kind: 'diff_summary',
          text: null,
          payload: summaryPayload,
          createdAt: new Date(),
        });
      }
      await this.deps.repo.bumpSession(sessionId, seq, session.eventCount + persisted.length);
      this.deps.liveEventHub.publish(taskId, persisted);
    }

    await this.deps.repo.finishSession(sessionId, {
      status: input.status,
      headAfter: input.headAfter,
      costUsd: input.costUsd,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
    });
    // Метеринг: реальный cost_usd прогона списываем с подписки диспетчера (userId).
    // Best-effort + идемпотентно (UNIQUE source+ref в ledger) — не должно валить завершение.
    void this.deps.recordUsage
      ?.execute({
        source: 'live',
        refId: sessionId,
        dispatcherUserId: userId,
        projectId,
        model: session.model,
        tokensIn: input.tokensIn,
        tokensOut: input.tokensOut,
        costUsd: input.costUsd,
      })
      .catch(() => {});
    this.deps.liveEventHub.publishEnd(taskId, input.status);
    this.broadcastChanged(projectId, taskId, sessionId, input.status);
    return { ok: true };
  }

  // ---------- read (участник проекта) ----------
  async listSessions(projectId: string, userId: string, taskId: string): Promise<LiveSession[]> {
    await this.authRead(projectId, userId);
    return this.deps.repo.listSessions(taskId);
  }

  async listEvents(
    projectId: string,
    userId: string,
    taskId: string,
    sessionId: string,
    afterSeq: number,
    limit: number,
  ): Promise<LiveEvent[]> {
    await this.authRead(projectId, userId);
    const session = await this.deps.repo.getSession(sessionId);
    if (!session || session.taskId !== taskId || session.projectId !== projectId) {
      throw new LiveSessionNotFoundError(sessionId);
    }
    return this.deps.repo.listEvents(sessionId, afterSeq, limit);
  }

  async listFileDiffs(
    projectId: string,
    userId: string,
    taskId: string,
    sessionId: string,
  ): Promise<LiveFileDiff[]> {
    await this.authRead(projectId, userId);
    const session = await this.deps.repo.getSession(sessionId);
    if (!session || session.taskId !== taskId || session.projectId !== projectId) {
      throw new LiveSessionNotFoundError(sessionId);
    }
    return this.deps.repo.listFileDiffs(sessionId);
  }

  // Для SSE-роута: гейт доступа + загрузка сессии (роут сам решает replay/subscribe/410).
  async getSessionForStream(
    projectId: string,
    userId: string,
    taskId: string,
    sessionId: string,
  ): Promise<LiveSession> {
    await this.authRead(projectId, userId);
    const session = await this.deps.repo.getSession(sessionId);
    if (!session || session.taskId !== taskId || session.projectId !== projectId) {
      throw new LiveSessionNotFoundError(sessionId);
    }
    return session;
  }

  // Startup: зависшие running → timeout. Best-effort (вызывается без await на старте).
  async sweepStaleRunning(olderThanHours = 24): Promise<number> {
    return this.deps.repo.sweepStaleRunning(olderThanHours);
  }

  // Хелпер для SSE-роута: финальные статусы.
  static isFinalStatus(status: LiveSession['status']): status is LiveSessionFinalStatus {
    return status !== 'running';
  }
}
