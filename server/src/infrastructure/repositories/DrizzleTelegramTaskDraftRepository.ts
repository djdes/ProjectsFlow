import { and, asc, eq, gt, isNotNull, lt, lte, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { telegramTaskDrafts, type TelegramTaskDraftRow } from '../db/schema.js';
import type {
  CreateTelegramTaskDraftInput,
  TelegramDraftOffered,
  TelegramDraftPhoto,
  TelegramDraftSegment,
  TelegramTaskDraft,
  TelegramTaskDraftPatch,
  TelegramTaskDraftRepository,
} from '../../application/telegram/TelegramTaskDraftRepository.js';
import { parseJsonCol } from './jsonCol.js';

function toDomain(r: TelegramTaskDraftRow): TelegramTaskDraft {
  return {
    id: r.id,
    creatorUserId: r.creatorUserId,
    tgChatId: Number(r.tgChatId),
    tgMessageId: r.tgMessageId === null ? null : Number(r.tgMessageId),
    taskText: r.taskText,
    projectId: r.projectId,
    assigneeUserId: r.assigneeUserId,
    offered: parseJsonCol<TelegramDraftOffered | null>(r.offered, null),
    // MariaDB отдаёт JSON-колонку строкой — обязательно через parseJsonCol (см. jsonCol.ts).
    segments: parseJsonCol<TelegramDraftSegment[] | null>(r.segments, null),
    photos: parseJsonCol<TelegramDraftPhoto[]>(r.photos, []),
    targetStatus: r.targetStatus,
    status: r.status,
    createdAt: r.createdAt,
    autoCreateAt: r.autoCreateAt,
    confirmationStartedAt: r.confirmationStartedAt,
    expiresAt: r.expiresAt,
  };
}

export class DrizzleTelegramTaskDraftRepository implements TelegramTaskDraftRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateTelegramTaskDraftInput): Promise<TelegramTaskDraft> {
    // expires_at = now + ttl. Считаем в SQL (CURRENT_TIMESTAMP) чтобы не зависеть от
    // рассинхрона часов app↔db.
    await this.db.insert(telegramTaskDrafts).values({
      id: input.id,
      creatorUserId: input.creatorUserId,
      tgChatId: input.tgChatId,
      tgMessageId: input.tgMessageId ?? null,
      taskText: input.taskText,
      projectId: input.projectId ?? null,
      assigneeUserId: input.assigneeUserId ?? null,
      offered: input.offered ?? null,
      segments: input.segments ?? null,
      photos: input.photos ? [...input.photos] : null,
      targetStatus: input.targetStatus ?? null,
      status: 'composing',
      autoCreateAt:
        input.autoCreateSeconds == null
          ? null
          : sql`DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ${input.autoCreateSeconds} SECOND)`,
      expiresAt: sql`DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ${input.ttlSeconds} SECOND)`,
    });
    const created = await this.loadById(input.id);
    if (!created) throw new Error(`draft ${input.id} disappeared right after insert`);
    return created;
  }

  async getById(id: string): Promise<TelegramTaskDraft | null> {
    const rows = await this.db
      .select()
      .from(telegramTaskDrafts)
      .where(and(eq(telegramTaskDrafts.id, id), gt(telegramTaskDrafts.expiresAt, sql`CURRENT_TIMESTAMP`)))
      .limit(1);
    const r = rows[0];
    return r ? toDomain(r) : null;
  }

  async patch(id: string, patch: TelegramTaskDraftPatch): Promise<TelegramTaskDraft | null> {
    const set: Partial<typeof telegramTaskDrafts.$inferInsert> = {};
    if (patch.taskText !== undefined) set.taskText = patch.taskText;
    if (patch.projectId !== undefined) set.projectId = patch.projectId;
    if (patch.assigneeUserId !== undefined) set.assigneeUserId = patch.assigneeUserId;
    if (patch.offered !== undefined) set.offered = patch.offered;
    if (patch.segments !== undefined) set.segments = patch.segments;
    if (patch.photos !== undefined) set.photos = [...patch.photos];
    if (patch.tgMessageId !== undefined) set.tgMessageId = patch.tgMessageId;
    if (patch.targetStatus !== undefined) set.targetStatus = patch.targetStatus;
    if (patch.status !== undefined) set.status = patch.status;
    if (Object.keys(set).length > 0) {
      await this.db.update(telegramTaskDrafts).set(set).where(eq(telegramTaskDrafts.id, id));
    }
    return this.loadById(id);
  }

  async listDueForAutoCreate(limit: number): Promise<TelegramTaskDraft[]> {
    const rows = await this.db
      .select()
      .from(telegramTaskDrafts)
      .where(
        and(
          eq(telegramTaskDrafts.status, 'composing'),
          isNotNull(telegramTaskDrafts.autoCreateAt),
          lte(telegramTaskDrafts.autoCreateAt, sql`CURRENT_TIMESTAMP`),
          gt(telegramTaskDrafts.expiresAt, sql`CURRENT_TIMESTAMP`),
        ),
      )
      .orderBy(asc(telegramTaskDrafts.autoCreateAt))
      .limit(Math.max(1, Math.min(limit, 100)));
    return rows.map(toDomain);
  }

  async claimForConfirmation(id: string, dueOnly: boolean): Promise<TelegramTaskDraft | null> {
    const conditions = [
      eq(telegramTaskDrafts.id, id),
      eq(telegramTaskDrafts.status, 'composing'),
      gt(telegramTaskDrafts.expiresAt, sql`CURRENT_TIMESTAMP`),
    ];
    if (dueOnly) {
      conditions.push(
        isNotNull(telegramTaskDrafts.autoCreateAt),
        lte(telegramTaskDrafts.autoCreateAt, sql`CURRENT_TIMESTAMP`),
      );
    }
    const result = await this.db
      .update(telegramTaskDrafts)
      .set({ status: 'confirming', confirmationStartedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(...conditions));
    if (affectedRows(result) === 0) return null;
    return this.loadById(id);
  }

  async releaseConfirmation(id: string, retrySeconds: number): Promise<void> {
    await this.db
      .update(telegramTaskDrafts)
      .set({
        status: 'composing',
        confirmationStartedAt: null,
        autoCreateAt: sql`DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ${retrySeconds} SECOND)`,
      })
      .where(and(eq(telegramTaskDrafts.id, id), eq(telegramTaskDrafts.status, 'confirming')));
  }

  async cancelComposing(id: string): Promise<boolean> {
    const result = await this.db
      .update(telegramTaskDrafts)
      .set({ status: 'cancelled', autoCreateAt: null })
      .where(and(eq(telegramTaskDrafts.id, id), eq(telegramTaskDrafts.status, 'composing')));
    return affectedRows(result) > 0;
  }

  async recoverStaleConfirmations(staleSeconds: number, retrySeconds: number): Promise<number> {
    const result = await this.db
      .update(telegramTaskDrafts)
      .set({
        status: 'composing',
        confirmationStartedAt: null,
        autoCreateAt: sql`DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ${retrySeconds} SECOND)`,
      })
      .where(
        and(
          eq(telegramTaskDrafts.status, 'confirming'),
          lt(
            telegramTaskDrafts.confirmationStartedAt,
            sql`DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${staleSeconds} SECOND)`,
          ),
        ),
      );
    return affectedRows(result);
  }

  async deleteExpired(): Promise<number> {
    const result = await this.db
      .delete(telegramTaskDrafts)
      .where(lt(telegramTaskDrafts.expiresAt, sql`CURRENT_TIMESTAMP`));
    // mysql2 возвращает affectedRows в первом элементе результата.
    return (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
  }

  // Без проверки expires_at — для чтения сразу после insert/patch (когда мы знаем что жив).
  private async loadById(id: string): Promise<TelegramTaskDraft | null> {
    const rows = await this.db
      .select()
      .from(telegramTaskDrafts)
      .where(eq(telegramTaskDrafts.id, id))
      .limit(1);
    const r = rows[0];
    return r ? toDomain(r) : null;
  }
}

function affectedRows(result: unknown): number {
  return (result as [{ affectedRows?: number }])[0]?.affectedRows ?? 0;
}
