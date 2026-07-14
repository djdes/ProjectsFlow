import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { telegramTaskDrafts, type TelegramTaskDraftRow } from '../db/schema.js';
import type {
  CreateTelegramTaskDraftInput,
  TelegramDraftOffered,
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
    taskText: r.taskText,
    projectId: r.projectId,
    assigneeUserId: r.assigneeUserId,
    offered: parseJsonCol<TelegramDraftOffered | null>(r.offered, null),
    // MariaDB отдаёт JSON-колонку строкой — обязательно через parseJsonCol (см. jsonCol.ts).
    segments: parseJsonCol<TelegramDraftSegment[] | null>(r.segments, null),
    targetStatus: r.targetStatus,
    status: r.status,
    createdAt: r.createdAt,
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
      taskText: input.taskText,
      projectId: input.projectId ?? null,
      assigneeUserId: input.assigneeUserId ?? null,
      offered: input.offered ?? null,
      segments: input.segments ?? null,
      targetStatus: input.targetStatus ?? null,
      status: 'composing',
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
    if (patch.targetStatus !== undefined) set.targetStatus = patch.targetStatus;
    if (patch.status !== undefined) set.status = patch.status;
    if (Object.keys(set).length > 0) {
      await this.db.update(telegramTaskDrafts).set(set).where(eq(telegramTaskDrafts.id, id));
    }
    return this.loadById(id);
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
