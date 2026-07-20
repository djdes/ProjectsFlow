import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { liveSessions, taskProgressEvents, type LiveSessionRow } from '../db/schema.js';
import type {
  LiveRepository,
  InsertLiveSessionInput,
  FinishLiveSessionInput,
} from '../../application/live/LiveRepository.js';
import type { LiveSession } from '../../domain/live/LiveSession.js';
import type { LiveEvent, LiveEventInput } from '../../domain/live/LiveEvent.js';
import type { LiveFileDiff, LiveFileChange } from '../../domain/live/LiveFileDiff.js';

// MariaDB хранит JSON как LONGTEXT → mysql2 возвращает СТРОКУ. На MySQL 8/9 приходит уже
// распарсенное. Нормализуем оба случая (тот же приём, что в DrizzleFileSyncRepository).
function parseJsonCol<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

function affected(result: unknown): number {
  return (result as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
}

// DECIMAL/BIGINT приходят из mysql2 строками → Number() (null остаётся null).
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toSession(r: LiveSessionRow): LiveSession {
  return {
    id: r.id,
    projectId: r.projectId,
    taskId: r.taskId,
    agentName: r.agentName ?? null,
    attempt: Number(r.attempt),
    status: r.status,
    model: r.model ?? null,
    billedUserId: r.billedUserId ?? null,
    headBefore: r.headBefore ?? null,
    headAfter: r.headAfter ?? null,
    costUsd: numOrNull(r.costUsd),
    tokensIn: numOrNull(r.tokensIn),
    tokensOut: numOrNull(r.tokensOut),
    baseSeq: Number(r.baseSeq),
    lastSeq: Number(r.lastSeq),
    eventCount: Number(r.eventCount),
    startedAt: r.startedAt,
    endedAt: r.endedAt ?? null,
  };
}

export class DrizzleLiveRepository implements LiveRepository {
  constructor(private readonly db: Database) {}

  async maxSeqForTask(taskId: string): Promise<number> {
    const rows = await this.db
      .select({ m: sql<number>`COALESCE(MAX(seq), 0)` })
      .from(taskProgressEvents)
      .where(eq(taskProgressEvents.taskId, taskId));
    return Number(rows[0]?.m ?? 0);
  }

  async insertSession(input: InsertLiveSessionInput): Promise<void> {
    const expiresAt =
      input.ttlSeconds === null
        ? null
        : sql`(NOW() + INTERVAL ${input.ttlSeconds} SECOND)`;
    await this.db.insert(liveSessions).values({
      id: input.id,
      projectId: input.projectId,
      taskId: input.taskId,
      agentName: input.agentName,
      attempt: input.attempt,
      status: 'running',
      model: input.model,
      billedUserId: input.billedUserId,
      headBefore: input.headBefore,
      baseSeq: input.baseSeq,
      lastSeq: input.baseSeq > 0 ? input.baseSeq - 1 : 0,
      eventCount: 0,
      ...(expiresAt === null ? {} : { expiresAt }),
    });
  }

  async getSession(sessionId: string): Promise<LiveSession | null> {
    const rows = await this.db.select().from(liveSessions).where(eq(liveSessions.id, sessionId)).limit(1);
    const row = rows[0];
    return row ? toSession(row) : null;
  }

  async listSessions(taskId: string): Promise<LiveSession[]> {
    const rows = await this.db
      .select()
      .from(liveSessions)
      .where(eq(liveSessions.taskId, taskId))
      .orderBy(desc(liveSessions.startedAt));
    return rows.map(toSession);
  }

  async listRecentProjectSessions(projectId: string, limit: number): Promise<LiveSession[]> {
    const rows = await this.db
      .select()
      .from(liveSessions)
      .where(eq(liveSessions.projectId, projectId))
      .orderBy(desc(liveSessions.startedAt))
      .limit(limit);
    return rows.map(toSession);
  }

  async countRunningProjectSessions(projectId: string): Promise<number> {
    const rows = await this.db
      .select({ c: sql<number>`COUNT(*)` })
      .from(liveSessions)
      .where(and(eq(liveSessions.projectId, projectId), eq(liveSessions.status, 'running')));
    return Number(rows[0]?.c ?? 0);
  }

  async appendEvent(input: {
    sessionId: string;
    taskId: string;
    projectId: string;
    event: LiveEventInput;
  }): Promise<boolean> {
    try {
      await this.db.insert(taskProgressEvents).values({
        taskId: input.taskId,
        projectId: input.projectId,
        sessionId: input.sessionId,
        seq: input.event.seq,
        kind: input.event.kind,
        text: input.event.text ?? null,
        payload: input.event.payload ?? null,
      });
      return true;
    } catch (e: unknown) {
      if ((e as { code?: string }).code === 'ER_DUP_ENTRY') return false;
      throw e;
    }
  }

  async bumpSession(sessionId: string, lastSeq: number, eventCount: number): Promise<void> {
    await this.db
      .update(liveSessions)
      .set({ lastSeq, eventCount })
      .where(eq(liveSessions.id, sessionId));
  }

  async finishSession(sessionId: string, input: FinishLiveSessionInput): Promise<void> {
    await this.db
      .update(liveSessions)
      .set({
        status: input.status,
        headAfter: input.headAfter,
        // DECIMAL принимает строку — приводим явно, null остаётся null.
        costUsd: input.costUsd === null ? null : String(input.costUsd),
        tokensIn: input.tokensIn,
        tokensOut: input.tokensOut,
        endedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(liveSessions.id, sessionId));
  }

  async listEvents(sessionId: string, afterSeq: number, limit: number): Promise<LiveEvent[]> {
    const rows = await this.db
      .select()
      .from(taskProgressEvents)
      .where(and(eq(taskProgressEvents.sessionId, sessionId), gt(taskProgressEvents.seq, afterSeq)))
      .orderBy(asc(taskProgressEvents.seq))
      .limit(limit);
    return rows.map((r) => ({
      seq: r.seq,
      kind: r.kind,
      text: r.text ?? null,
      payload: parseJsonCol<unknown>(r.payload, null),
      createdAt: r.createdAt,
    }));
  }

  async listFileDiffs(sessionId: string): Promise<LiveFileDiff[]> {
    const rows = await this.db
      .select()
      .from(taskProgressEvents)
      .where(and(eq(taskProgressEvents.sessionId, sessionId), eq(taskProgressEvents.kind, 'file_diff')))
      .orderBy(asc(taskProgressEvents.seq));
    return rows.map((r) => {
      const p = parseJsonCol<{
        path?: string;
        change?: string;
        additions?: number;
        deletions?: number;
        unifiedDiff?: string | null;
        isBinary?: boolean;
        truncated?: boolean;
      }>(r.payload, {});
      return {
        path: p.path ?? '',
        change: (p.change ?? 'modified') as LiveFileChange,
        additions: Number(p.additions ?? 0),
        deletions: Number(p.deletions ?? 0),
        unifiedDiff: p.unifiedDiff ?? null,
        isBinary: p.isBinary ?? false,
        truncated: p.truncated ?? false,
      };
    });
  }

  async sweepStaleRunning(olderThanHours: number): Promise<number> {
    const result = await this.db
      .update(liveSessions)
      .set({ status: 'timeout', endedAt: sql`CURRENT_TIMESTAMP` })
      .where(
        sql`${liveSessions.status} = 'running' AND ${liveSessions.createdAt} < (NOW() - INTERVAL ${olderThanHours} HOUR)`,
      );
    return affected(result);
  }
}
