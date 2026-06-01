import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
  syncWorkspaces,
  syncBlobs,
  syncSnapshots,
  syncFileEntries,
  syncChangeSets,
  syncSessions,
  taskProgressEvents,
  type SyncWorkspaceRow,
  type SyncSnapshotRow,
  type SyncSessionRow,
} from '../db/schema.js';
import { computePathHash } from '../../domain/file-sync/paths.js';
import type { ManifestEntry } from '../../domain/file-sync/manifest.js';
import type { ChangeOp, ChangeSetCounts } from '../../domain/file-sync/changeSet.js';
import type {
  FileSyncRepository,
  SyncWorkspace,
  SyncSnapshot,
  SyncSession,
  SessionStatus,
  SnapshotStatus,
  CreateWorkspaceInput,
  CreateSnapshotInput,
  CreateSessionInput,
  GarbageBlob,
  ProgressEvent,
} from '../../application/file-sync/FileSyncRepository.js';

function affected(result: unknown): number {
  return (result as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
}

// MariaDB хранит JSON как LONGTEXT → mysql2 возвращает СТРОКУ, а не объект/массив
// (drizzle-orm не парсит json-колонки: нет mapFromDriverValue). На MySQL 8/9 приходит
// уже распарсенное. Нормализуем оба случая. Тот же приём, что в DrizzleNotificationRepository.
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

function toWorkspace(r: SyncWorkspaceRow): SyncWorkspace {
  return {
    id: r.id,
    projectId: r.projectId,
    label: r.label ?? null,
    baseSnapshotId: r.baseSnapshotId ?? null,
    baseVersion: Number(r.baseVersion),
    dispatcherHeadSnapshotId: r.dispatcherHeadSnapshotId ?? null,
    ignoreSet: parseJsonCol<string[]>(r.ignoreSetJson, []),
    ignoreSetHash: r.ignoreSetHash,
    isCaseSensitive: r.isCaseSensitive === 1,
    clientProtocolVersion: r.clientProtocolVersion,
    pendingApply: r.pendingApply === 1,
    quotaBytes: Number(r.quotaBytes),
    usedBytes: Number(r.usedBytes),
  };
}

function toSnapshot(r: SyncSnapshotRow): SyncSnapshot {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    source: r.source,
    parentSnapshotId: r.parentSnapshotId ?? null,
    taskId: r.taskId ?? null,
    status: r.status,
    fileCount: r.fileCount,
    totalBytes: Number(r.totalBytes),
    manifestSha: r.manifestSha ?? null,
    ignoreSetHash: r.ignoreSetHash,
  };
}

function toSession(r: SyncSessionRow): SyncSession {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    taskId: r.taskId ?? null,
    baseSnapshotId: r.baseSnapshotId,
    resultSnapshotId: r.resultSnapshotId ?? null,
    status: r.status,
    conflictJson: parseJsonCol<unknown>(r.conflictJson, null),
    idempotencyKey: r.idempotencyKey ?? null,
  };
}

export class DrizzleFileSyncRepository implements FileSyncRepository {
  constructor(private readonly db: Database) {}

  // ---------- workspaces ----------
  async getWorkspaceByProject(projectId: string): Promise<SyncWorkspace | null> {
    const rows = await this.db.select().from(syncWorkspaces).where(eq(syncWorkspaces.projectId, projectId)).limit(1);
    return rows[0] ? toWorkspace(rows[0]) : null;
  }

  async getWorkspaceById(workspaceId: string): Promise<SyncWorkspace | null> {
    const rows = await this.db.select().from(syncWorkspaces).where(eq(syncWorkspaces.id, workspaceId)).limit(1);
    return rows[0] ? toWorkspace(rows[0]) : null;
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<SyncWorkspace> {
    await this.db.insert(syncWorkspaces).values({
      id: input.id,
      projectId: input.projectId,
      label: input.label,
      ignoreSetJson: input.ignoreSet,
      ignoreSetHash: input.ignoreSetHash,
      isCaseSensitive: input.isCaseSensitive ? 1 : 0,
    });
    const fresh = await this.getWorkspaceById(input.id);
    if (!fresh) throw new Error('Failed to read back workspace after insert');
    return fresh;
  }

  async casAdvanceBase(workspaceId: string, expectedVersion: number, newBaseSnapshotId: string): Promise<boolean> {
    const result = await this.db
      .update(syncWorkspaces)
      .set({ baseSnapshotId: newBaseSnapshotId, baseVersion: sql`base_version + 1`, pendingApply: 0 })
      .where(and(eq(syncWorkspaces.id, workspaceId), eq(syncWorkspaces.baseVersion, expectedVersion)));
    return affected(result) > 0;
  }

  async setDispatcherHead(workspaceId: string, snapshotId: string): Promise<void> {
    await this.db
      .update(syncWorkspaces)
      .set({ dispatcherHeadSnapshotId: snapshotId })
      .where(eq(syncWorkspaces.id, workspaceId));
  }

  async setPendingApply(workspaceId: string, value: boolean): Promise<void> {
    await this.db
      .update(syncWorkspaces)
      .set({ pendingApply: value ? 1 : 0 })
      .where(eq(syncWorkspaces.id, workspaceId));
  }

  async addUsedBytes(workspaceId: string, delta: number): Promise<void> {
    await this.db
      .update(syncWorkspaces)
      .set({ usedBytes: sql`GREATEST(CAST(used_bytes AS SIGNED) + ${delta}, 0)` })
      .where(eq(syncWorkspaces.id, workspaceId));
  }

  // ---------- snapshots ----------
  async createSnapshot(input: CreateSnapshotInput): Promise<void> {
    await this.db.insert(syncSnapshots).values({
      id: input.id,
      workspaceId: input.workspaceId,
      source: input.source,
      parentSnapshotId: input.parentSnapshotId,
      taskId: input.taskId,
      status: 'draft',
      ignoreSetHash: input.ignoreSetHash,
    });
  }

  async getSnapshot(id: string): Promise<SyncSnapshot | null> {
    const rows = await this.db.select().from(syncSnapshots).where(eq(syncSnapshots.id, id)).limit(1);
    return rows[0] ? toSnapshot(rows[0]) : null;
  }

  async sealSnapshot(id: string, manifestSha: string, fileCount: number, totalBytes: number): Promise<void> {
    await this.db
      .update(syncSnapshots)
      .set({ status: 'sealed', manifestSha, fileCount, totalBytes, sealedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(syncSnapshots.id, id));
  }

  async setSnapshotStatus(id: string, status: SnapshotStatus): Promise<void> {
    await this.db.update(syncSnapshots).set({ status }).where(eq(syncSnapshots.id, id));
  }

  async touchSnapshot(id: string): Promise<void> {
    await this.db.update(syncSnapshots).set({ updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(syncSnapshots.id, id));
  }

  async listDraftsOlderThan(maxAgeSeconds: number, limit: number): Promise<readonly { id: string }[]> {
    const rows = await this.db
      .select({ id: syncSnapshots.id })
      .from(syncSnapshots)
      .where(sql`status = 'draft' AND updated_at < (NOW() - INTERVAL ${maxAgeSeconds} SECOND)`)
      .limit(limit);
    return rows;
  }

  // ---------- file entries ----------
  async insertFileEntries(snapshotId: string, entries: readonly ManifestEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const rows = entries.map((e) => ({
      snapshotId,
      path: e.path,
      pathHash: computePathHash(e.path),
      blobSha: e.isSymlink ? null : e.sha256,
      sizeBytes: e.size,
      mode: e.mode,
      mtimeMs: e.mtimeMs ?? null,
      isSymlink: e.isSymlink ? 1 : 0,
      symlinkTarget: e.symlinkTarget ?? null,
    }));
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await this.db.insert(syncFileEntries).values(rows.slice(i, i + CHUNK));
    }
  }

  async listFileEntries(snapshotId: string): Promise<ManifestEntry[]> {
    const rows = await this.db
      .select()
      .from(syncFileEntries)
      .where(eq(syncFileEntries.snapshotId, snapshotId))
      .orderBy(asc(syncFileEntries.path));
    return rows.map((r) => ({
      path: r.path,
      sha256: r.blobSha ?? null,
      size: Number(r.sizeBytes),
      mode: r.mode,
      mtimeMs: r.mtimeMs === null || r.mtimeMs === undefined ? null : Number(r.mtimeMs),
      isSymlink: r.isSymlink === 1,
      symlinkTarget: r.symlinkTarget ?? null,
    }));
  }

  async snapshotHasBlob(snapshotId: string, sha256: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: syncFileEntries.id })
      .from(syncFileEntries)
      .where(and(eq(syncFileEntries.snapshotId, snapshotId), eq(syncFileEntries.blobSha, sha256)))
      .limit(1);
    return rows.length > 0;
  }

  async distinctBlobShas(snapshotId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ blobSha: syncFileEntries.blobSha })
      .from(syncFileEntries)
      .where(and(eq(syncFileEntries.snapshotId, snapshotId), eq(syncFileEntries.isSymlink, 0)));
    const out: string[] = [];
    for (const r of rows) if (r.blobSha) out.push(r.blobSha);
    return out;
  }

  // ---------- blobs ----------
  async presentBlobShas(shas: readonly string[]): Promise<Set<string>> {
    if (shas.length === 0) return new Set();
    const rows = await this.db
      .select({ sha256: syncBlobs.sha256 })
      .from(syncBlobs)
      .where(inArray(syncBlobs.sha256, [...shas]));
    return new Set(rows.map((r) => r.sha256));
  }

  async upsertBlobPinned(sha256: string, sizeBytes: number, storageKey: string, pinTtlSeconds: number): Promise<void> {
    // Пин по часам БД (NOW() + ttl) — без JS-Date, tz-иммунно.
    const pin = sql`(NOW() + INTERVAL ${pinTtlSeconds} SECOND)`;
    await this.db
      .insert(syncBlobs)
      .values({ sha256, sizeBytes, storageKey, refCount: 0, pinnedUntil: pin })
      .onDuplicateKeyUpdate({ set: { pinnedUntil: pin, sizeBytes, storageKey } });
  }

  async incrementRefCounts(shas: readonly string[]): Promise<void> {
    if (shas.length === 0) return;
    await this.db
      .update(syncBlobs)
      .set({ refCount: sql`ref_count + 1` })
      .where(inArray(syncBlobs.sha256, [...shas]));
  }

  async decrementRefCounts(shas: readonly string[]): Promise<void> {
    if (shas.length === 0) return;
    await this.db
      .update(syncBlobs)
      .set({ refCount: sql`GREATEST(ref_count - 1, 0)` })
      .where(inArray(syncBlobs.sha256, [...shas]));
  }

  async listGarbageBlobs(limit: number): Promise<readonly GarbageBlob[]> {
    // ref_count=0 AND пин истёк (по NOW() БД) AND не в НЕ-aborted снепшоте (двойная страховка).
    const rows = await this.db
      .select({ sha256: syncBlobs.sha256, storageKey: syncBlobs.storageKey })
      .from(syncBlobs)
      .where(
        sql`${syncBlobs.refCount} = 0
          AND (${syncBlobs.pinnedUntil} IS NULL OR ${syncBlobs.pinnedUntil} < NOW())
          AND NOT EXISTS (
            SELECT 1 FROM sync_file_entries fe
            JOIN sync_snapshots s ON s.id = fe.snapshot_id
            WHERE fe.blob_sha = ${syncBlobs.sha256} AND s.status <> 'aborted'
          )`,
      )
      .limit(limit);
    return rows;
  }

  async deleteBlobRow(sha256: string): Promise<void> {
    await this.db.delete(syncBlobs).where(eq(syncBlobs.sha256, sha256));
  }

  // ---------- change-sets ----------
  async getChangeSet(
    baseSnapshotId: string,
    headSnapshotId: string,
  ): Promise<{ ops: ChangeOp[]; counts: ChangeSetCounts } | null> {
    const rows = await this.db
      .select()
      .from(syncChangeSets)
      .where(and(eq(syncChangeSets.baseSnapshotId, baseSnapshotId), eq(syncChangeSets.headSnapshotId, headSnapshotId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      ops: parseJsonCol<ChangeOp[]>(row.changesJson, []),
      counts: { added: row.addedCount, modified: row.modifiedCount, deleted: row.deletedCount },
    };
  }

  async createChangeSet(input: {
    id: string;
    baseSnapshotId: string;
    headSnapshotId: string;
    ops: ChangeOp[];
    counts: ChangeSetCounts;
  }): Promise<void> {
    await this.db
      .insert(syncChangeSets)
      .values({
        id: input.id,
        baseSnapshotId: input.baseSnapshotId,
        headSnapshotId: input.headSnapshotId,
        changesJson: input.ops,
        addedCount: input.counts.added,
        modifiedCount: input.counts.modified,
        deletedCount: input.counts.deleted,
      })
      .onDuplicateKeyUpdate({ set: { headSnapshotId: input.headSnapshotId } });
  }

  // ---------- sessions ----------
  async createSession(input: CreateSessionInput): Promise<SyncSession> {
    await this.db.insert(syncSessions).values({
      id: input.id,
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      baseSnapshotId: input.baseSnapshotId,
      idempotencyKey: input.idempotencyKey,
      status: 'uploaded',
    });
    const fresh = await this.getSession(input.id);
    if (!fresh) throw new Error('Failed to read back session after insert');
    return fresh;
  }

  async getSession(id: string): Promise<SyncSession | null> {
    const rows = await this.db.select().from(syncSessions).where(eq(syncSessions.id, id)).limit(1);
    return rows[0] ? toSession(rows[0]) : null;
  }

  async findSessionByIdem(workspaceId: string, key: string): Promise<SyncSession | null> {
    const rows = await this.db
      .select()
      .from(syncSessions)
      .where(and(eq(syncSessions.workspaceId, workspaceId), eq(syncSessions.idempotencyKey, key)))
      .limit(1);
    return rows[0] ? toSession(rows[0]) : null;
  }

  async listSessions(
    workspaceId: string,
    statuses: readonly SessionStatus[],
    taskId?: string | null,
  ): Promise<SyncSession[]> {
    const conds = [eq(syncSessions.workspaceId, workspaceId)];
    if (statuses.length > 0) conds.push(inArray(syncSessions.status, [...statuses]));
    if (taskId) conds.push(eq(syncSessions.taskId, taskId));
    const rows = await this.db
      .select()
      .from(syncSessions)
      .where(and(...conds))
      .orderBy(asc(syncSessions.createdAt));
    return rows.map(toSession);
  }

  async setSessionResult(id: string, resultSnapshotId: string, status: SessionStatus): Promise<void> {
    await this.db.update(syncSessions).set({ resultSnapshotId, status }).where(eq(syncSessions.id, id));
  }

  async setSessionStatus(id: string, status: SessionStatus, conflictJson?: unknown): Promise<void> {
    const patch: { status: SessionStatus; conflictJson?: unknown } = { status };
    if (conflictJson !== undefined) patch.conflictJson = conflictJson;
    await this.db.update(syncSessions).set(patch).where(eq(syncSessions.id, id));
  }

  // ---------- progress events ----------
  async appendProgressEvent(input: {
    taskId: string;
    projectId: string;
    seq: number;
    kind: string;
    text: string | null;
    payload: unknown | null;
  }): Promise<boolean> {
    try {
      await this.db.insert(taskProgressEvents).values({
        taskId: input.taskId,
        projectId: input.projectId,
        seq: input.seq,
        kind: input.kind,
        text: input.text,
        payload: input.payload ?? null,
      });
      return true;
    } catch (e: unknown) {
      if ((e as { code?: string }).code === 'ER_DUP_ENTRY') return false;
      throw e;
    }
  }

  async listProgressEvents(taskId: string, sinceSeq: number, limit: number): Promise<ProgressEvent[]> {
    const rows = await this.db
      .select()
      .from(taskProgressEvents)
      .where(and(eq(taskProgressEvents.taskId, taskId), gt(taskProgressEvents.seq, sinceSeq)))
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

  async maxProgressSeq(taskId: string): Promise<number> {
    const rows = await this.db
      .select({ m: sql<number>`COALESCE(MAX(seq), 0)` })
      .from(taskProgressEvents)
      .where(eq(taskProgressEvents.taskId, taskId));
    return Number(rows[0]?.m ?? 0);
  }
}
