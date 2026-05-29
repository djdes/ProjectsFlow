// Доменные ошибки file-sync. Каждая мапится в HTTP-статус в presentation/middleware/errorHandler.ts.

export class SyncWorkspaceNotFoundError extends Error {
  constructor(public readonly workspaceId: string) {
    super(`Sync workspace not found: ${workspaceId}`);
    this.name = 'SyncWorkspaceNotFoundError';
  }
}

export class SyncSnapshotNotFoundError extends Error {
  constructor(public readonly snapshotId: string) {
    super(`Sync snapshot not found: ${snapshotId}`);
    this.name = 'SyncSnapshotNotFoundError';
  }
}

export class SyncSessionNotFoundError extends Error {
  constructor(public readonly sessionId: string) {
    super(`Sync session not found: ${sessionId}`);
    this.name = 'SyncSessionNotFoundError';
  }
}

export class SnapshotNotSealedError extends Error {
  constructor(public readonly snapshotId: string) {
    super(`Snapshot not sealed: ${snapshotId}`);
    this.name = 'SnapshotNotSealedError';
  }
}

export class BlobShaMismatchError extends Error {
  constructor(public readonly expected: string, public readonly actual: string) {
    super(`Blob sha mismatch: expected ${expected}, got ${actual}`);
    this.name = 'BlobShaMismatchError';
  }
}

export class BlobMissingError extends Error {
  constructor(public readonly sha256: string) {
    super(`Required blob missing: ${sha256}`);
    this.name = 'BlobMissingError';
  }
}

export class SyncQuotaExceededError extends Error {
  constructor(public readonly usedBytes: number, public readonly quotaBytes: number) {
    super(`Workspace quota exceeded: ${usedBytes} > ${quotaBytes}`);
    this.name = 'SyncQuotaExceededError';
  }
}

export class BaseMovedConflictError extends Error {
  constructor(public readonly expectedVersion: number, public readonly actualVersion: number) {
    super(`Workspace base moved: expected version ${expectedVersion}, actual ${actualVersion}`);
    this.name = 'BaseMovedConflictError';
  }
}

export class IgnoreSetMismatchError extends Error {
  constructor(public readonly baseHash: string, public readonly resultHash: string) {
    super(`Ignore-set hash mismatch: base ${baseHash} vs result ${resultHash}`);
    this.name = 'IgnoreSetMismatchError';
  }
}

export class InvalidManifestPathError extends Error {
  constructor(public readonly path: string, public readonly reason: string) {
    super(`Invalid manifest path "${path}": ${reason}`);
    this.name = 'InvalidManifestPathError';
  }
}

export class CaseCollisionError extends Error {
  constructor(public readonly pathA: string, public readonly pathB: string) {
    super(`Case-only path collision (unsupported on Windows): "${pathA}" vs "${pathB}"`);
    this.name = 'CaseCollisionError';
  }
}

// Запрос байтов снепшота не от назначенного диспетчера проекта (см. SP2 act_as_dispatcher).
export class NotAssignedDispatcherError extends Error {
  readonly status = 403;
  constructor(public readonly projectId: string) {
    super(`Caller is not the assigned dispatcher for project ${projectId}`);
    this.name = 'NotAssignedDispatcherError';
  }
}
