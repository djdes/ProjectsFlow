import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import { requireProjectAccess, requireDispatcherAccess } from '../project/projectAccess.js';
import type { FileSyncRepository, SyncWorkspace, SyncSession, SessionStatus } from './FileSyncRepository.js';
import type { BlobStorage } from './BlobStorage.js';
import { type ManifestEntry, canonicalManifestSha, canonicalIgnoreSetHash } from '../../domain/file-sync/manifest.js';
import { diffManifests, countChanges, type ChangeOp, type ChangeSetCounts } from '../../domain/file-sync/changeSet.js';
import { validateManifestPath, findCaseCollision } from '../../domain/file-sync/paths.js';
import {
  SyncWorkspaceNotFoundError,
  SyncSnapshotNotFoundError,
  SyncSessionNotFoundError,
  SnapshotNotSealedError,
  BlobShaMismatchError,
  BlobMissingError,
  SyncQuotaExceededError,
  IgnoreSetMismatchError,
  CaseCollisionError,
} from '../../domain/file-sync/errors.js';
import { createHash } from 'node:crypto';

export type FileSyncDeps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly repo: FileSyncRepository;
  readonly storage: BlobStorage;
  readonly idGen: () => string;
  readonly now: () => Date;
  // Server-authoritative ignore-set (обе стороны тянут и сверяют hash).
  readonly serverIgnoreSet: readonly string[];
  readonly draftPinTtlSeconds: number;
  readonly maxBlobBytes: number;
};

export type SnapshotSource = 'client' | 'dispatcher';

function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export class FileSyncService {
  constructor(private readonly deps: FileSyncDeps) {}

  private get accessDeps() {
    return { projects: this.deps.projects, members: this.deps.members };
  }

  // Клиент-владелец проекта пушит/ack'ает; dispatcher-операции гейтятся отдельно.
  private async authClient(projectId: string, userId: string): Promise<void> {
    await requireProjectAccess(this.accessDeps, projectId, userId, 'manage_file_sync');
  }

  private async authRead(projectId: string, userId: string): Promise<void> {
    await requireProjectAccess(this.accessDeps, projectId, userId, 'read_project');
  }

  private async authDispatcher(projectId: string, userId: string): Promise<void> {
    await requireDispatcherAccess(this.accessDeps, projectId, userId);
  }

  private async authForSource(projectId: string, userId: string, source: SnapshotSource): Promise<void> {
    if (source === 'dispatcher') await this.authDispatcher(projectId, userId);
    else await this.authClient(projectId, userId);
  }

  // ---------- workspace ----------
  async ensureWorkspace(
    projectId: string,
    userId: string,
    label: string | null,
  ): Promise<{ workspace: SyncWorkspace; ignoreSet: string[]; ignoreSetHash: string }> {
    await this.authClient(projectId, userId);
    const ignoreSet = [...this.deps.serverIgnoreSet];
    const ignoreSetHash = canonicalIgnoreSetHash(ignoreSet);
    let ws = await this.deps.repo.getWorkspaceByProject(projectId);
    if (!ws) {
      ws = await this.deps.repo.createWorkspace({
        id: this.deps.idGen(),
        projectId,
        label,
        ignoreSet,
        ignoreSetHash,
        isCaseSensitive: false, // Windows-origin по умолчанию
      });
    }
    return { workspace: ws, ignoreSet: ws.ignoreSet, ignoreSetHash: ws.ignoreSetHash };
  }

  async getWorkspace(projectId: string, userId: string): Promise<SyncWorkspace> {
    await this.authRead(projectId, userId);
    const ws = await this.deps.repo.getWorkspaceByProject(projectId);
    if (!ws) throw new SyncWorkspaceNotFoundError(projectId);
    return ws;
  }

  private async loadWorkspaceForProject(projectId: string): Promise<SyncWorkspace> {
    const ws = await this.deps.repo.getWorkspaceByProject(projectId);
    if (!ws) throw new SyncWorkspaceNotFoundError(projectId);
    return ws;
  }

  // ---------- snapshot draft ----------
  async createSnapshotDraft(
    projectId: string,
    userId: string,
    input: {
      source: SnapshotSource;
      entries: ManifestEntry[];
      taskId?: string | null;
      parentSnapshotId?: string | null;
    },
  ): Promise<{ snapshotId: string; missingBlobs: string[] }> {
    await this.authForSource(projectId, userId, input.source);
    const ws = await this.loadWorkspaceForProject(projectId);

    // Валидация путей (независимо от ОС хоста).
    for (const e of input.entries) validateManifestPath(e.path);

    // Case-коллизии (для Windows-origin workspace недопустимы).
    if (!ws.isCaseSensitive) {
      const collision = findCaseCollision(input.entries.map((e) => e.path));
      if (collision) throw new CaseCollisionError(collision[0], collision[1]);
    }

    const snapshotId = this.deps.idGen();
    await this.deps.repo.createSnapshot({
      id: snapshotId,
      workspaceId: ws.id,
      source: input.source,
      parentSnapshotId: input.parentSnapshotId ?? null,
      taskId: input.taskId ?? null,
      ignoreSetHash: ws.ignoreSetHash,
    });
    await this.deps.repo.insertFileEntries(snapshotId, input.entries);

    // missingBlobs — ТОЛЬКО из shas, которые прислал caller (без кросс-tenant оракула).
    const submitted = [
      ...new Set(input.entries.filter((e) => !e.isSymlink && e.sha256).map((e) => e.sha256 as string)),
    ];
    const present = await this.deps.repo.presentBlobShas(submitted);
    const missingBlobs = submitted.filter((s) => !present.has(s));
    return { snapshotId, missingBlobs };
  }

  // ---------- blob upload ----------
  async uploadBlob(
    projectId: string,
    userId: string,
    sha256: string,
    data: Buffer,
    source: SnapshotSource,
  ): Promise<void> {
    await this.authForSource(projectId, userId, source);
    if (data.byteLength > this.deps.maxBlobBytes) {
      throw new SyncQuotaExceededError(data.byteLength, this.deps.maxBlobBytes);
    }
    const actual = sha256Hex(data);
    if (actual !== sha256.toLowerCase()) throw new BlobShaMismatchError(sha256, actual);
    await this.deps.storage.put(actual, data);
    await this.deps.repo.upsertBlobPinned(
      actual,
      data.byteLength,
      this.deps.storage.storageKey(actual),
      this.deps.draftPinTtlSeconds,
    );
  }

  // ---------- seal ----------
  async sealSnapshot(
    projectId: string,
    userId: string,
    snapshotId: string,
    source: SnapshotSource,
  ): Promise<{ snapshotId: string; manifestSha: string; fileCount: number; totalBytes: number; baseSet: boolean }> {
    await this.authForSource(projectId, userId, source);
    const ws = await this.loadWorkspaceForProject(projectId);
    const snap = await this.deps.repo.getSnapshot(snapshotId);
    if (!snap || snap.workspaceId !== ws.id) throw new SyncSnapshotNotFoundError(snapshotId);

    const entries = await this.deps.repo.listFileEntries(snapshotId);
    const distinct = await this.deps.repo.distinctBlobShas(snapshotId);
    const present = await this.deps.repo.presentBlobShas(distinct);
    const missing = distinct.filter((s) => !present.has(s));
    if (missing.length > 0) throw new BlobMissingError(missing[0] as string);

    const manifestSha = canonicalManifestSha(entries);
    const totalBytes = entries.reduce((acc, e) => acc + (e.size || 0), 0);

    // Квота (приблизительно: суммарный размер; дедуп не вычитаем — консервативный потолок).
    if (ws.usedBytes + totalBytes > ws.quotaBytes) {
      throw new SyncQuotaExceededError(ws.usedBytes + totalBytes, ws.quotaBytes);
    }

    await this.deps.repo.sealSnapshot(snapshotId, manifestSha, entries.length, totalBytes);
    await this.deps.repo.incrementRefCounts(distinct);
    await this.deps.repo.addUsedBytes(ws.id, totalBytes);

    // Первый client-снепшот становится base (диспетчеру есть от чего материализоваться).
    let baseSet = false;
    if (source === 'client' && ws.baseSnapshotId === null) {
      baseSet = await this.deps.repo.casAdvanceBase(ws.id, ws.baseVersion, snapshotId);
    }
    return { snapshotId, manifestSha, fileCount: entries.length, totalBytes, baseSet };
  }

  // ---------- manifest / blob read ----------
  async getManifest(
    projectId: string,
    userId: string,
    snapshotId: string,
    asDispatcher: boolean,
  ): Promise<ManifestEntry[]> {
    if (asDispatcher) await this.authDispatcher(projectId, userId);
    else await this.authRead(projectId, userId);
    const ws = await this.loadWorkspaceForProject(projectId);
    const snap = await this.deps.repo.getSnapshot(snapshotId);
    if (!snap || snap.workspaceId !== ws.id) throw new SyncSnapshotNotFoundError(snapshotId);
    if (snap.status !== 'sealed') throw new SnapshotNotSealedError(snapshotId);
    return this.deps.repo.listFileEntries(snapshotId);
  }

  async getBlob(
    projectId: string,
    userId: string,
    snapshotId: string,
    sha256: string,
    asDispatcher: boolean,
  ): Promise<Buffer> {
    if (asDispatcher) await this.authDispatcher(projectId, userId);
    else await this.authRead(projectId, userId);
    const ws = await this.loadWorkspaceForProject(projectId);
    const snap = await this.deps.repo.getSnapshot(snapshotId);
    if (!snap || snap.workspaceId !== ws.id) throw new SyncSnapshotNotFoundError(snapshotId);
    // Без sha-guessing оракула: снепшот ДОЛЖЕН содержать этот blob.
    const has = await this.deps.repo.snapshotHasBlob(snapshotId, sha256);
    if (!has) throw new BlobMissingError(sha256);
    const data = await this.deps.storage.read(sha256);
    if (!data) throw new BlobMissingError(sha256);
    return data;
  }

  // ---------- sessions ----------
  async openSession(
    projectId: string,
    userId: string,
    input: { baseSnapshotId: string; taskId?: string | null; idempotencyKey?: string | null },
  ): Promise<SyncSession> {
    await this.authClient(projectId, userId);
    const ws = await this.loadWorkspaceForProject(projectId);
    if (input.idempotencyKey) {
      const existing = await this.deps.repo.findSessionByIdem(ws.id, input.idempotencyKey);
      if (existing) return existing;
    }
    const base = await this.deps.repo.getSnapshot(input.baseSnapshotId);
    if (!base || base.workspaceId !== ws.id) throw new SyncSnapshotNotFoundError(input.baseSnapshotId);
    if (base.status !== 'sealed') throw new SnapshotNotSealedError(input.baseSnapshotId);
    return this.deps.repo.createSession({
      id: this.deps.idGen(),
      workspaceId: ws.id,
      taskId: input.taskId ?? null,
      baseSnapshotId: input.baseSnapshotId,
      idempotencyKey: input.idempotencyKey ?? null,
    });
  }

  async listSessions(
    projectId: string,
    userId: string,
    statuses: SessionStatus[],
    taskId?: string | null,
  ): Promise<SyncSession[]> {
    await this.authRead(projectId, userId);
    const ws = await this.loadWorkspaceForProject(projectId);
    return this.deps.repo.listSessions(ws.id, statuses, taskId ?? null);
  }

  // Диспетчер записывает результат. base НЕ двигается здесь (двигается на client ack).
  async recordSnapshotResult(
    projectId: string,
    userId: string,
    sessionId: string,
    resultSnapshotId: string,
  ): Promise<{ status: SessionStatus; changeCounts: ChangeSetCounts }> {
    await this.authDispatcher(projectId, userId);
    const ws = await this.loadWorkspaceForProject(projectId);
    const session = await this.deps.repo.getSession(sessionId);
    if (!session || session.workspaceId !== ws.id) throw new SyncSessionNotFoundError(sessionId);

    const base = await this.deps.repo.getSnapshot(session.baseSnapshotId);
    const result = await this.deps.repo.getSnapshot(resultSnapshotId);
    if (!base) throw new SyncSnapshotNotFoundError(session.baseSnapshotId);
    if (!result || result.workspaceId !== ws.id) throw new SyncSnapshotNotFoundError(resultSnapshotId);
    if (result.status !== 'sealed') throw new SnapshotNotSealedError(resultSnapshotId);

    // Структурная защита от потери данных: ignore-set producer'а результата ОБЯЗАН совпадать с base.
    if (result.ignoreSetHash !== base.ignoreSetHash) {
      throw new IgnoreSetMismatchError(base.ignoreSetHash, result.ignoreSetHash);
    }

    const counts = await this.computeAndCacheChangeSet(session.baseSnapshotId, resultSnapshotId);
    await this.deps.repo.setSessionResult(sessionId, resultSnapshotId, 'result_ready');
    await this.deps.repo.setDispatcherHead(ws.id, resultSnapshotId);
    await this.deps.repo.setPendingApply(ws.id, true);
    return { status: 'result_ready', changeCounts: counts };
  }

  private async computeAndCacheChangeSet(
    baseSnapshotId: string,
    headSnapshotId: string,
  ): Promise<ChangeSetCounts> {
    const cached = await this.deps.repo.getChangeSet(baseSnapshotId, headSnapshotId);
    if (cached) return cached.counts;
    const baseEntries = await this.deps.repo.listFileEntries(baseSnapshotId);
    const headEntries = await this.deps.repo.listFileEntries(headSnapshotId);
    const ops = diffManifests(baseEntries, headEntries);
    const counts = countChanges(ops);
    await this.deps.repo.createChangeSet({
      id: this.deps.idGen(),
      baseSnapshotId,
      headSnapshotId,
      ops,
      counts,
    });
    return counts;
  }

  async getChangeSet(
    projectId: string,
    userId: string,
    baseSnapshotId: string,
    headSnapshotId: string,
  ): Promise<{ ops: ChangeOp[]; counts: ChangeSetCounts }> {
    await this.authRead(projectId, userId);
    const cached = await this.deps.repo.getChangeSet(baseSnapshotId, headSnapshotId);
    if (cached) return cached;
    const baseEntries = await this.deps.repo.listFileEntries(baseSnapshotId);
    const headEntries = await this.deps.repo.listFileEntries(headSnapshotId);
    const ops = diffManifests(baseEntries, headEntries);
    const counts = countChanges(ops);
    await this.deps.repo.createChangeSet({ id: this.deps.idGen(), baseSnapshotId, headSnapshotId, ops, counts });
    return { ops, counts };
  }

  // Клиент подтверждает применение. base двигается ТОЛЬКО при чистом applied (CAS, single-writer).
  async ackSession(
    projectId: string,
    userId: string,
    sessionId: string,
    outcome: 'applied' | 'conflict' | 'partial',
    conflicts?: unknown,
  ): Promise<{ baseAdvanced: boolean; status: SessionStatus }> {
    await this.authClient(projectId, userId);
    const ws = await this.loadWorkspaceForProject(projectId);
    const session = await this.deps.repo.getSession(sessionId);
    if (!session || session.workspaceId !== ws.id) throw new SyncSessionNotFoundError(sessionId);
    if (!session.resultSnapshotId) throw new SnapshotNotSealedError(sessionId);

    if (outcome === 'applied') {
      const advanced = await this.deps.repo.casAdvanceBase(ws.id, ws.baseVersion, session.resultSnapshotId);
      if (advanced) {
        await this.deps.repo.setSessionStatus(sessionId, 'applied');
        return { baseAdvanced: true, status: 'applied' };
      }
      // base сдвинулся параллельно — это конфликт, base не трогаем.
      await this.deps.repo.setSessionStatus(sessionId, 'conflict', conflicts ?? { reason: 'base_moved' });
      return { baseAdvanced: false, status: 'conflict' };
    }

    const status: SessionStatus = outcome === 'partial' ? 'partial' : 'conflict';
    await this.deps.repo.setSessionStatus(sessionId, status, conflicts);
    return { baseAdvanced: false, status };
  }

  // ---------- progress ----------
  async appendProgressEvents(
    projectId: string,
    userId: string,
    taskId: string,
    events: readonly { seq: number; kind: string; text?: string | null; payload?: unknown }[],
  ): Promise<{ appended: number }> {
    await this.authDispatcher(projectId, userId);
    let appended = 0;
    for (const ev of events) {
      const ok = await this.deps.repo.appendProgressEvent({
        taskId,
        projectId,
        seq: ev.seq,
        kind: ev.kind,
        text: ev.text ?? null,
        payload: ev.payload ?? null,
      });
      if (ok) appended++;
    }
    return { appended };
  }

  async listProgressEvents(
    projectId: string,
    userId: string,
    taskId: string,
    sinceSeq: number,
    limit: number,
  ): Promise<{ events: { seq: number; kind: string; text: string | null; payload: unknown; createdAt: Date }[] }> {
    await this.authRead(projectId, userId);
    const events = await this.deps.repo.listProgressEvents(taskId, sinceSeq, limit);
    return { events };
  }

  // ---------- GC ----------
  async pruneExpired(
    draftMaxAgeSeconds: number,
    limit: number,
  ): Promise<{ abortedDrafts: number; deletedBlobs: number }> {
    const drafts = await this.deps.repo.listDraftsOlderThan(draftMaxAgeSeconds, limit);
    for (const d of drafts) await this.deps.repo.setSnapshotStatus(d.id, 'aborted');

    const garbage = await this.deps.repo.listGarbageBlobs(limit);
    for (const g of garbage) {
      await this.deps.storage.delete(g.sha256);
      await this.deps.repo.deleteBlobRow(g.sha256);
    }
    return { abortedDrafts: drafts.length, deletedBlobs: garbage.length };
  }
}
