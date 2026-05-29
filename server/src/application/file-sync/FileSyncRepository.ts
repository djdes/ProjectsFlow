import type { ManifestEntry } from '../../domain/file-sync/manifest.js';
import type { ChangeOp, ChangeSetCounts } from '../../domain/file-sync/changeSet.js';

export type SyncWorkspace = {
  readonly id: string;
  readonly projectId: string;
  readonly label: string | null;
  readonly baseSnapshotId: string | null;
  readonly baseVersion: number;
  readonly dispatcherHeadSnapshotId: string | null;
  readonly ignoreSet: string[];
  readonly ignoreSetHash: string;
  readonly isCaseSensitive: boolean;
  readonly clientProtocolVersion: number;
  readonly pendingApply: boolean;
  readonly quotaBytes: number;
  readonly usedBytes: number;
};

export type SnapshotSource = 'client' | 'dispatcher';
export type SnapshotStatus = 'draft' | 'sealed' | 'aborted';

export type SyncSnapshot = {
  readonly id: string;
  readonly workspaceId: string;
  readonly source: SnapshotSource;
  readonly parentSnapshotId: string | null;
  readonly taskId: string | null;
  readonly status: SnapshotStatus;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly manifestSha: string | null;
  readonly ignoreSetHash: string;
};

export type SessionStatus =
  | 'uploaded'
  | 'materialized'
  | 'result_ready'
  | 'applied'
  | 'conflict'
  | 'partial'
  | 'aborted';

export type SyncSession = {
  readonly id: string;
  readonly workspaceId: string;
  readonly taskId: string | null;
  readonly baseSnapshotId: string;
  readonly resultSnapshotId: string | null;
  readonly status: SessionStatus;
  readonly conflictJson: unknown | null;
  readonly idempotencyKey: string | null;
};

export type ProgressEvent = {
  readonly seq: number;
  readonly kind: string;
  readonly text: string | null;
  readonly payload: unknown | null;
  readonly createdAt: Date;
};

export type CreateWorkspaceInput = {
  readonly id: string;
  readonly projectId: string;
  readonly label: string | null;
  readonly ignoreSet: string[];
  readonly ignoreSetHash: string;
  readonly isCaseSensitive: boolean;
};

export type CreateSnapshotInput = {
  readonly id: string;
  readonly workspaceId: string;
  readonly source: SnapshotSource;
  readonly parentSnapshotId: string | null;
  readonly taskId: string | null;
  readonly ignoreSetHash: string;
};

export type CreateSessionInput = {
  readonly id: string;
  readonly workspaceId: string;
  readonly taskId: string | null;
  readonly baseSnapshotId: string;
  readonly idempotencyKey: string | null;
};

export type GarbageBlob = { readonly sha256: string; readonly storageKey: string };

export interface FileSyncRepository {
  // --- workspaces ---
  getWorkspaceByProject(projectId: string): Promise<SyncWorkspace | null>;
  getWorkspaceById(workspaceId: string): Promise<SyncWorkspace | null>;
  createWorkspace(input: CreateWorkspaceInput): Promise<SyncWorkspace>;
  // CAS: двигает base только если base_version совпал. true — успех.
  casAdvanceBase(workspaceId: string, expectedVersion: number, newBaseSnapshotId: string): Promise<boolean>;
  setDispatcherHead(workspaceId: string, snapshotId: string): Promise<void>;
  setPendingApply(workspaceId: string, value: boolean): Promise<void>;
  addUsedBytes(workspaceId: string, delta: number): Promise<void>;

  // --- snapshots ---
  createSnapshot(input: CreateSnapshotInput): Promise<void>;
  getSnapshot(id: string): Promise<SyncSnapshot | null>;
  sealSnapshot(id: string, manifestSha: string, fileCount: number, totalBytes: number): Promise<void>;
  setSnapshotStatus(id: string, status: SnapshotStatus): Promise<void>;
  touchSnapshot(id: string): Promise<void>;
  // Драфты, не обновлявшиеся дольше maxAgeSeconds (по часам БД — tz-иммунно).
  listDraftsOlderThan(maxAgeSeconds: number, limit: number): Promise<readonly { id: string }[]>;

  // --- file entries ---
  insertFileEntries(snapshotId: string, entries: readonly ManifestEntry[]): Promise<void>;
  listFileEntries(snapshotId: string): Promise<ManifestEntry[]>;
  distinctBlobShas(snapshotId: string): Promise<string[]>;
  // Содержит ли снепшот файл с данным blob_sha (для getBlob без sha-guessing оракула).
  snapshotHasBlob(snapshotId: string, sha256: string): Promise<boolean>;

  // --- blobs ---
  presentBlobShas(shas: readonly string[]): Promise<Set<string>>;
  // Пин = NOW() + ttlSeconds (по часам БД — tz-иммунно), защищает блоб от GC до seal.
  upsertBlobPinned(sha256: string, sizeBytes: number, storageKey: string, pinTtlSeconds: number): Promise<void>;
  incrementRefCounts(shas: readonly string[]): Promise<void>;
  decrementRefCounts(shas: readonly string[]): Promise<void>;
  // Кандидаты на сборку: ref_count=0, пин истёк (по NOW() БД), не в non-aborted снепшоте.
  listGarbageBlobs(limit: number): Promise<readonly GarbageBlob[]>;
  deleteBlobRow(sha256: string): Promise<void>;

  // --- change-sets ---
  getChangeSet(baseSnapshotId: string, headSnapshotId: string): Promise<{ ops: ChangeOp[]; counts: ChangeSetCounts } | null>;
  createChangeSet(input: {
    id: string;
    baseSnapshotId: string;
    headSnapshotId: string;
    ops: ChangeOp[];
    counts: ChangeSetCounts;
  }): Promise<void>;

  // --- sessions ---
  createSession(input: CreateSessionInput): Promise<SyncSession>;
  getSession(id: string): Promise<SyncSession | null>;
  findSessionByIdem(workspaceId: string, key: string): Promise<SyncSession | null>;
  listSessions(workspaceId: string, statuses: readonly SessionStatus[], taskId?: string | null): Promise<SyncSession[]>;
  setSessionResult(id: string, resultSnapshotId: string, status: SessionStatus): Promise<void>;
  setSessionStatus(id: string, status: SessionStatus, conflictJson?: unknown): Promise<void>;

  // --- progress events ---
  appendProgressEvent(input: {
    taskId: string;
    projectId: string;
    seq: number;
    kind: string;
    text: string | null;
    payload: unknown | null;
  }): Promise<boolean>;
  listProgressEvents(taskId: string, sinceSeq: number, limit: number): Promise<ProgressEvent[]>;
  maxProgressSeq(taskId: string): Promise<number>;
}
