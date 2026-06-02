import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { telegramTaskDrafts, type TelegramTaskDraftRow } from '../db/schema.js';
import type {
  CreateTelegramTaskDraftInput,
  TelegramDraftOffered,
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
    delegateUserId: r.delegateUserId,
    delegationId: r.delegationId,
    offered: parseJsonCol<TelegramDraftOffered | null>(r.offered, null),
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
      delegateUserId: input.delegateUserId ?? null,
      offered: input.offered ?? null,
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

  async getByDelegationId(delegationId: string): Promise<TelegramTaskDraft | null> {
    const rows = await this.db
      .select()
      .from(telegramTaskDrafts)
      .where(eq(telegramTaskDrafts.delegationId, delegationId))
      .limit(1);
    const r = rows[0];
    return r ? toDomain(r) : null;
  }

  async patch(id: string, patch: TelegramTaskDraftPatch): Promise<TelegramTaskDraft | null> {
    const set: Partial<typeof telegramTaskDrafts.$inferInsert> = {};
    if (patch.taskText !== undefined) set.taskText = patch.taskText;
    if (patch.projectId !== undefined) set.projectId = patch.projectId;
    if (patch.delegateUserId !== undefined) set.delegateUserId = patch.delegateUserId;
    if (patch.delegationId !== undefined) set.delegationId = patch.delegationId;
    if (patch.offered !== undefined) set.offered = patch.offered;
    if (patch.status !== undefined) set.status = patch.status;
    const touched = Object.keys(set).length > 0 || patch.extendTtlSeconds !== undefined;
    if (touched) {
      // expires_at — SQL-выражение (DATE_ADD от CURRENT_TIMESTAMP), поэтому передаём
      // объект прямо в .set() (там тип значений допускает SQL, в отличие от $inferInsert).
      await this.db
        .update(telegramTaskDrafts)
        .set(
          patch.extendTtlSeconds !== undefined
            ? {
                ...set,
                expiresAt: sql`DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ${patch.extendTtlSeconds} SECOND)`,
              }
            : set,
        )
        .where(eq(telegramTaskDrafts.id, id));
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
