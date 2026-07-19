import type {
  ProjectEditJob,
  ProjectEditOperation,
  SiteEditorSession,
  SiteElementLocator,
  SitePatch,
  SitePatchKind,
  SitePatchSnapshot,
} from '../../domain/site-editor/SiteEditor.js';

export type CreateSessionRecord = Omit<SiteEditorSession, 'revokedAt' | 'createdAt'>;

export type CreatePatchRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly route: string;
  readonly baseRevision: number;
  readonly idempotencyKey: string;
  readonly locator: SiteElementLocator;
  readonly kind: SitePatchKind;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdBy: string;
};

export type UpdatePatchRecord = {
  readonly projectId: string;
  readonly patchId: string;
  readonly baseRevision: number;
  readonly locator: SiteElementLocator;
  readonly kind: SitePatchKind;
  readonly payload: Readonly<Record<string, unknown>>;
};

export type CreateProjectEditJobRecord = {
  readonly id: string;
  readonly projectId: string;
  readonly createdBy: string;
  readonly idempotencyKey: string;
  readonly dispatcherUserId: string;
  readonly operation: ProjectEditOperation;
  readonly route: string;
  readonly locator: SiteElementLocator;
  readonly domSnapshot: string;
  readonly computedStyles: Readonly<Record<string, string>>;
  readonly prompt: string;
  readonly artifactVersion: string;
};

export interface SiteEditorRepository {
  createSession(input: CreateSessionRecord): Promise<SiteEditorSession>;
  getSession(projectId: string, sessionId: string): Promise<SiteEditorSession | null>;
  findSessionByTokenHash(projectId: string, tokenHash: string): Promise<SiteEditorSession | null>;
  revokeSession(projectId: string, sessionId: string, revokedAt: Date): Promise<boolean>;

  getPatches(projectId: string, route: string): Promise<SitePatchSnapshot>;
  createPatch(input: CreatePatchRecord): Promise<SitePatchSnapshot>;
  getPatch(projectId: string, patchId: string): Promise<SitePatch | null>;
  updatePatch(input: UpdatePatchRecord): Promise<SitePatchSnapshot>;
  deletePatch(projectId: string, patchId: string, baseRevision: number): Promise<SitePatchSnapshot>;
  undoPatch(projectId: string, route: string, baseRevision: number): Promise<SitePatchSnapshot>;
  redoPatch(projectId: string, route: string, baseRevision: number): Promise<SitePatchSnapshot>;
  rejectDraft(projectId: string, route: string, baseRevision: number): Promise<SitePatchSnapshot>;
  queueDraftPublish(input: CreateProjectEditJobRecord & { readonly baseRevision: number }): Promise<{ readonly job: ProjectEditJob; readonly snapshot: SitePatchSnapshot }>;
  hasQueuedPublishJob(projectId: string, jobId: string): Promise<boolean>;

  createJob(input: CreateProjectEditJobRecord): Promise<ProjectEditJob>;
  getJob(projectId: string, jobId: string): Promise<ProjectEditJob | null>;
  listQueuedJobs(projectId: string, dispatcherUserId: string, limit: number): Promise<readonly ProjectEditJob[]>;
  // Кросс-проектный вариант для раннера: он поллит одну глобальную очередь, а не обходит
  // проекты по одному. Именно отсутствие такого листинга оставляло publish-job'ы в
  // queued навсегда — раннер про per-project роут просто не знал.
  listQueuedJobsForDispatcher(dispatcherUserId: string, limit: number): Promise<readonly ProjectEditJob[]>;
  claimJob(projectId: string, jobId: string, dispatcherUserId: string, claimedAt: Date): Promise<ProjectEditJob | null>;
  // Job'ы, зависшие в running: воркер забрал задачу и умер, не отчитавшись. Без подметания
  // они висят вечно, а пользователь смотрит на спиннер, который никогда не остановится.
  listStaleRunningJobs(claimedBefore: Date, limit: number): Promise<readonly ProjectEditJob[]>;
  completeJob(input: {
    readonly projectId: string;
    readonly jobId: string;
    readonly dispatcherUserId: string;
    readonly status: 'succeeded' | 'failed';
    readonly result: Readonly<Record<string, unknown>> | null;
    readonly error: string | null;
    readonly finishedAt: Date;
  }): Promise<ProjectEditJob | null>;
}
