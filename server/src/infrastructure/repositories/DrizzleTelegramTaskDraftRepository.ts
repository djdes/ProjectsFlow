import { and, asc, eq, gt, isNotNull, lt, lte, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { telegramTaskDrafts, type TelegramTaskDraftRow } from '../db/schema.js';
import type {
  CreateTelegramTaskDraftInput,
  TelegramDraftAttachment,
  TelegramDraftOffered,
  TelegramDraftPhoto,
  TelegramDraftSegment,
  TelegramTaskDraft,
  TelegramTaskDraftPatch,
  TelegramTaskDraftRepository,
} from '../../application/telegram/TelegramTaskDraftRepository.js';
import { parseJsonCol } from './jsonCol.js';

function defaultTargetSegmentIndexes(segments: readonly TelegramDraftSegment[] | null): number[] {
  if (!segments?.length) return [0];
  const firstIncluded = segments.findIndex((segment) => segment.included);
  return [firstIncluded >= 0 ? firstIncluded : 0];
}

function legacyPhotosToAttachments(
  photos: readonly TelegramDraftPhoto[],
  segments: readonly TelegramDraftSegment[] | null,
): TelegramDraftAttachment[] {
  const targetSegmentIndexes = defaultTargetSegmentIndexes(segments);
  return photos.map((photo, index) => ({
    key: `photo:${photo.fileUniqueId ?? `${index}:${photo.fileId}`}`,
    kind: 'photo',
    fileId: photo.fileId,
    fileUniqueId: photo.fileUniqueId,
    filename: `telegram-photo-${index + 1}.jpg`,
    mimeType: 'image/jpeg',
    fileSize: photo.fileSize,
    width: photo.width,
    height: photo.height,
    duration: null,
    targetSegmentIndexes: [...targetSegmentIndexes],
  }));
}

function cloneAttachments(
  attachments: readonly TelegramDraftAttachment[],
): TelegramDraftAttachment[] {
  return attachments.map((attachment) => ({
    ...attachment,
    targetSegmentIndexes: [...attachment.targetSegmentIndexes],
  }));
}

function attachmentsToPhotoProjection(
  attachments: readonly TelegramDraftAttachment[],
): TelegramDraftPhoto[] {
  return attachments
    .filter((attachment) => attachment.kind === 'photo')
    .map((attachment) => ({
      fileId: attachment.fileId,
      fileUniqueId: attachment.fileUniqueId,
      width: attachment.width ?? 0,
      height: attachment.height ?? 0,
      fileSize: attachment.fileSize,
    }));
}

function mergeLegacyPhotoPatch(
  current: readonly TelegramDraftAttachment[],
  photos: readonly TelegramDraftPhoto[],
  segments: readonly TelegramDraftSegment[] | null,
): TelegramDraftAttachment[] {
  const currentPhotos = new Map(
    current
      .filter((attachment) => attachment.kind === 'photo')
      .map((attachment) => [attachment.fileUniqueId ?? attachment.fileId, attachment]),
  );
  const projected = legacyPhotosToAttachments(photos, segments).map((attachment) => {
    const existing = currentPhotos.get(attachment.fileUniqueId ?? attachment.fileId);
    return existing
      ? { ...existing, targetSegmentIndexes: [...existing.targetSegmentIndexes] }
      : attachment;
  });
  return [
    ...current
      .filter((attachment) => attachment.kind !== 'photo')
      .map((attachment) => ({
        ...attachment,
        targetSegmentIndexes: [...attachment.targetSegmentIndexes],
      })),
    ...projected,
  ];
}

function toDomain(r: TelegramTaskDraftRow): TelegramTaskDraft {
  const segments = parseJsonCol<TelegramDraftSegment[] | null>(r.segments, null);
  const photos = parseJsonCol<TelegramDraftPhoto[]>(r.photos, []);
  const storedAttachments = parseJsonCol<TelegramDraftAttachment[] | null>(r.attachments, null);
  return {
    id: r.id,
    creatorUserId: r.creatorUserId,
    tgChatId: Number(r.tgChatId),
    tgMessageId: r.tgMessageId === null ? null : Number(r.tgMessageId),
    sourceKey: r.sourceKey,
    taskText: r.taskText,
    projectId: r.projectId,
    assigneeUserId: r.assigneeUserId,
    offered: parseJsonCol<TelegramDraftOffered | null>(r.offered, null),
    // MariaDB отдаёт JSON-колонку строкой — обязательно через parseJsonCol (см. jsonCol.ts).
    segments,
    photos,
    // NULL is a legacy row; [] is an intentional empty generalized media list.
    attachments:
      storedAttachments === null
        ? legacyPhotosToAttachments(photos, segments)
        : cloneAttachments(storedAttachments),
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
    if (input.sourceKey !== undefined && input.sourceKey !== null) {
      const existing = await this.findBySourceKey(input.sourceKey);
      if (existing) return existing;
    }
    const attachments =
      input.attachments !== undefined
        ? cloneAttachments(input.attachments)
        : input.photos !== undefined
          ? legacyPhotosToAttachments(input.photos, input.segments ?? null)
          : null;
    const photos = attachments === null ? null : attachmentsToPhotoProjection(attachments);
    // expires_at = now + ttl. Считаем в SQL (CURRENT_TIMESTAMP) чтобы не зависеть от
    // рассинхрона часов app↔db.
    try {
      await this.db.insert(telegramTaskDrafts).values({
        id: input.id,
        creatorUserId: input.creatorUserId,
        tgChatId: input.tgChatId,
        tgMessageId: input.tgMessageId ?? null,
        sourceKey: input.sourceKey ?? null,
        taskText: input.taskText,
        projectId: input.projectId ?? null,
        assigneeUserId: input.assigneeUserId ?? null,
        offered: input.offered ?? null,
        segments: input.segments ?? null,
        photos,
        attachments,
        targetStatus: input.targetStatus ?? null,
        status: 'composing',
        autoCreateAt:
          input.autoCreateSeconds == null
            ? null
            : sql`DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ${input.autoCreateSeconds} SECOND)`,
        expiresAt: sql`DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ${input.ttlSeconds} SECOND)`,
      });
    } catch (err) {
      // The unique source key resolves concurrent webhook/poller delivery races.
      if (input.sourceKey !== undefined && input.sourceKey !== null) {
        const existing = await this.findBySourceKey(input.sourceKey);
        if (existing) return existing;
      }
      throw err;
    }
    const created = input.sourceKey !== undefined && input.sourceKey !== null
      ? ((await this.findBySourceKey(input.sourceKey)) ?? (await this.loadById(input.id)))
      : await this.loadById(input.id);
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

  async findBySourceKey(sourceKey: string): Promise<TelegramTaskDraft | null> {
    const rows = await this.db
      .select()
      .from(telegramTaskDrafts)
      .where(eq(telegramTaskDrafts.sourceKey, sourceKey))
      .limit(1);
    const r = rows[0];
    return r ? toDomain(r) : null;
  }

  async patch(id: string, patch: TelegramTaskDraftPatch): Promise<TelegramTaskDraft | null> {
    const set = await this.patchValues(id, patch);
    if (Object.keys(set).length > 0) {
      await this.db.update(telegramTaskDrafts).set(set).where(eq(telegramTaskDrafts.id, id));
    }
    return this.loadById(id);
  }

  async patchComposing(
    id: string,
    patch: TelegramTaskDraftPatch,
  ): Promise<TelegramTaskDraft | null> {
    const set = await this.patchValues(id, patch);
    if (Object.keys(set).length === 0) {
      const current = await this.loadById(id);
      return current?.status === 'composing' ? current : null;
    }
    const result = await this.db
      .update(telegramTaskDrafts)
      .set(set)
      .where(and(eq(telegramTaskDrafts.id, id), eq(telegramTaskDrafts.status, 'composing')));
    if (affectedRows(result) === 0) return null;
    return this.loadById(id);
  }

  private async patchValues(
    id: string,
    patch: TelegramTaskDraftPatch,
  ): Promise<Partial<typeof telegramTaskDrafts.$inferInsert>> {
    const set: Partial<typeof telegramTaskDrafts.$inferInsert> = {};
    if (patch.taskText !== undefined) set.taskText = patch.taskText;
    if (patch.projectId !== undefined) set.projectId = patch.projectId;
    if (patch.assigneeUserId !== undefined) set.assigneeUserId = patch.assigneeUserId;
    if (patch.offered !== undefined) set.offered = patch.offered;
    if (patch.segments !== undefined) set.segments = patch.segments;
    if (patch.attachments !== undefined) {
      const attachments = cloneAttachments(patch.attachments);
      set.attachments = attachments;
      set.photos = attachmentsToPhotoProjection(attachments);
    } else if (patch.photos !== undefined) {
      const current = await this.loadById(id);
      const segments = patch.segments !== undefined ? patch.segments : (current?.segments ?? null);
      const attachments = mergeLegacyPhotoPatch(current?.attachments ?? [], patch.photos, segments);
      set.photos = [...patch.photos];
      set.attachments = attachments;
    }
    if (patch.tgMessageId !== undefined) set.tgMessageId = patch.tgMessageId;
    if (patch.sourceKey !== undefined) set.sourceKey = patch.sourceKey;
    if (patch.targetStatus !== undefined) set.targetStatus = patch.targetStatus;
    if (patch.status !== undefined) set.status = patch.status;
    return set;
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
