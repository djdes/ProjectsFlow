import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import {
  projectEditJobs,
  siteEditorSessions,
  sitePatches,
  sitePatchSets,
} from '../db/schema.js';
import type {
  CreatePatchRecord,
  CreateProjectEditJobRecord,
  CreateSessionRecord,
  SiteEditorRepository,
  UpdatePatchRecord,
} from '../../application/site-editor/SiteEditorRepository.js';
import type {
  ProjectEditJob,
  SiteEditorSession,
  SiteElementLocator,
  SitePatch,
  SitePatchSnapshot,
} from '../../domain/site-editor/SiteEditor.js';
import {
  ProjectEditJobNotFoundError,
  SiteEditorPatchNotFoundError,
  SiteEditorRevisionConflictError,
} from '../../domain/site-editor/errors.js';

type SessionRow = typeof siteEditorSessions.$inferSelect;
type PatchRow = typeof sitePatches.$inferSelect;
type PatchSetRow = typeof sitePatchSets.$inferSelect;
type JobRow = typeof projectEditJobs.$inferSelect;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toSession(row: SessionRow): SiteEditorSession {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    tokenHash: row.tokenHash,
    route: row.route,
    artifactVersion: row.artifactVersion,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

function toPatch(row: PatchRow): SitePatch {
  return {
    id: row.id,
    projectId: row.projectId,
    patchSetId: row.patchSetId,
    locator: parseJson<SiteElementLocator>(row.locatorJson, {
      cssPath: '',
      tagName: 'div',
      stableAttributes: {},
    }),
    kind: row.kind,
    payload: parseJson<Record<string, unknown>>(row.payloadJson, {}),
    idempotencyKey: row.idempotencyKey,
    createdRevision: row.createdRevision,
    createdBy: row.createdBy,
    state: row.state,
    publishJobId: row.publishJobId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toJob(row: JobRow): ProjectEditJob {
  return {
    id: row.id,
    projectId: row.projectId,
    createdBy: row.createdBy,
    idempotencyKey: row.idempotencyKey,
    dispatcherUserId: row.dispatcherUserId,
    status: row.status,
    operation: row.operation,
    route: row.route,
    locator: parseJson<SiteElementLocator>(row.locatorJson, {
      cssPath: '',
      tagName: 'div',
      stableAttributes: {},
    }),
    domSnapshot: row.domSnapshot,
    computedStyles: parseJson<Record<string, string>>(row.computedStylesJson, {}),
    prompt: row.prompt,
    artifactVersion: row.artifactVersion,
    result: row.resultJson ? parseJson<Record<string, unknown>>(row.resultJson, {}) : null,
    error: row.error,
    claimedAt: row.claimedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleSiteEditorRepository implements SiteEditorRepository {
  constructor(private readonly db: Database) {}

  async createSession(input: CreateSessionRecord): Promise<SiteEditorSession> {
    await this.db.insert(siteEditorSessions).values(input);
    const rows = await this.db.select().from(siteEditorSessions)
      .where(and(eq(siteEditorSessions.projectId, input.projectId), eq(siteEditorSessions.id, input.id)))
      .limit(1);
    if (!rows[0]) throw new Error('Failed to read site editor session');
    return toSession(rows[0]);
  }

  async findSessionByTokenHash(projectId: string, tokenHash: string): Promise<SiteEditorSession | null> {
    const rows = await this.db.select().from(siteEditorSessions)
      .where(and(eq(siteEditorSessions.projectId, projectId), eq(siteEditorSessions.tokenHash, tokenHash)))
      .limit(1);
    return rows[0] ? toSession(rows[0]) : null;
  }

  async getSession(projectId: string, sessionId: string): Promise<SiteEditorSession | null> {
    const rows = await this.db.select().from(siteEditorSessions)
      .where(and(eq(siteEditorSessions.projectId, projectId), eq(siteEditorSessions.id, sessionId)))
      .limit(1);
    return rows[0] ? toSession(rows[0]) : null;
  }

  async revokeSession(projectId: string, sessionId: string, revokedAt: Date): Promise<boolean> {
    const result = await this.db.update(siteEditorSessions).set({ revokedAt })
      .where(and(eq(siteEditorSessions.projectId, projectId), eq(siteEditorSessions.id, sessionId), isNull(siteEditorSessions.revokedAt)));
    return Number(result[0].affectedRows) > 0;
  }

  async getPatches(projectId: string, route: string): Promise<SitePatchSnapshot> {
    const sets = await this.db.select().from(sitePatchSets)
      .where(and(eq(sitePatchSets.projectId, projectId), eq(sitePatchSets.route, route))).limit(1);
    if (!sets[0]) {
      return { revision: 0, patches: [], draftCount: 0, redoCount: 0, queuedCount: 0, publishJobId: null };
    }
    return this.snapshot(this.db, sets[0]);
  }

  async createPatch(input: CreatePatchRecord): Promise<SitePatchSnapshot> {
    return this.db.transaction(async (tx) => {
      const set = await this.lockOrCreatePatchSet(tx, input.projectId, input.route, input.id);
      const replay = await tx.select().from(sitePatches).where(and(
        eq(sitePatches.patchSetId, set.id),
        eq(sitePatches.idempotencyKey, input.idempotencyKey),
      )).limit(1);
      if (replay[0]) return this.snapshot(tx, set);
      this.assertRevision(set, input.baseRevision);
      // Creating a new edit after undo starts a new history branch. Old redo rows
      // must not be resurrectable through the session endpoint.
      await tx.delete(sitePatches).where(and(
        eq(sitePatches.projectId, input.projectId),
        eq(sitePatches.patchSetId, set.id),
        eq(sitePatches.state, 'draft'),
        isNotNull(sitePatches.deletedAt),
      ));
      const revision = set.revision + 1;
      await tx.insert(sitePatches).values({
        id: input.id,
        patchSetId: set.id,
        projectId: input.projectId,
        locatorJson: JSON.stringify(input.locator),
        kind: input.kind,
        payloadJson: JSON.stringify(input.payload),
        idempotencyKey: input.idempotencyKey,
        createdRevision: revision,
        createdBy: input.createdBy,
      });
      await tx.update(sitePatchSets).set({ revision }).where(and(
        eq(sitePatchSets.id, set.id),
        eq(sitePatchSets.projectId, input.projectId),
      ));
      return this.snapshot(tx, { ...set, revision });
    });
  }

  async getPatch(projectId: string, patchId: string): Promise<SitePatch | null> {
    const rows = await this.db.select().from(sitePatches).where(and(
      eq(sitePatches.projectId, projectId),
      eq(sitePatches.id, patchId),
      isNull(sitePatches.deletedAt),
    )).limit(1);
    return rows[0] ? toPatch(rows[0]) : null;
  }

  async updatePatch(input: UpdatePatchRecord): Promise<SitePatchSnapshot> {
    return this.db.transaction(async (tx) => {
      const patches = await tx.select().from(sitePatches).where(and(
        eq(sitePatches.projectId, input.projectId),
        eq(sitePatches.id, input.patchId),
        isNull(sitePatches.deletedAt),
      )).limit(1).for('update');
      if (!patches[0]) throw new SiteEditorPatchNotFoundError();
      const set = await this.lockPatchSet(tx, input.projectId, patches[0].patchSetId);
      this.assertRevision(set, input.baseRevision);
      const revision = set.revision + 1;
      await tx.update(sitePatches).set({
        locatorJson: JSON.stringify(input.locator),
        kind: input.kind,
        payloadJson: JSON.stringify(input.payload),
      }).where(and(eq(sitePatches.projectId, input.projectId), eq(sitePatches.id, input.patchId)));
      await tx.update(sitePatchSets).set({ revision }).where(eq(sitePatchSets.id, set.id));
      return this.snapshot(tx, { ...set, revision });
    });
  }

  async deletePatch(projectId: string, patchId: string, baseRevision: number): Promise<SitePatchSnapshot> {
    return this.db.transaction(async (tx) => {
      const patches = await tx.select().from(sitePatches).where(and(
        eq(sitePatches.projectId, projectId),
        eq(sitePatches.id, patchId),
        isNull(sitePatches.deletedAt),
      )).limit(1).for('update');
      if (!patches[0]) throw new SiteEditorPatchNotFoundError();
      const set = await this.lockPatchSet(tx, projectId, patches[0].patchSetId);
      this.assertRevision(set, baseRevision);
      const revision = set.revision + 1;
      await tx.update(sitePatches).set({ deletedAt: sql`CURRENT_TIMESTAMP` }).where(and(
        eq(sitePatches.projectId, projectId), eq(sitePatches.id, patchId),
      ));
      await tx.update(sitePatchSets).set({ revision }).where(eq(sitePatchSets.id, set.id));
      return this.snapshot(tx, { ...set, revision });
    });
  }

  async undoPatch(projectId: string, route: string, baseRevision: number): Promise<SitePatchSnapshot> {
    return this.db.transaction(async (tx) => {
      const set = await this.lockPatchSetByRoute(tx, projectId, route);
      this.assertRevision(set, baseRevision);
      const rows = await tx.select().from(sitePatches).where(and(
        eq(sitePatches.projectId, projectId), eq(sitePatches.patchSetId, set.id),
        eq(sitePatches.state, 'draft'), isNull(sitePatches.deletedAt),
      )).orderBy(desc(sitePatches.createdRevision), desc(sitePatches.updatedAt)).limit(1).for('update');
      if (!rows[0]) return this.snapshot(tx, set);
      const revision = set.revision + 1;
      await tx.update(sitePatches).set({ deletedAt: sql`CURRENT_TIMESTAMP` }).where(and(
        eq(sitePatches.projectId, projectId), eq(sitePatches.id, rows[0].id),
      ));
      await tx.update(sitePatchSets).set({ revision }).where(eq(sitePatchSets.id, set.id));
      return this.snapshot(tx, { ...set, revision });
    });
  }

  async redoPatch(projectId: string, route: string, baseRevision: number): Promise<SitePatchSnapshot> {
    return this.db.transaction(async (tx) => {
      const set = await this.lockPatchSetByRoute(tx, projectId, route);
      this.assertRevision(set, baseRevision);
      const rows = await tx.select().from(sitePatches).where(and(
        eq(sitePatches.projectId, projectId), eq(sitePatches.patchSetId, set.id),
        eq(sitePatches.state, 'draft'), isNotNull(sitePatches.deletedAt),
      )).orderBy(desc(sitePatches.updatedAt)).limit(1).for('update');
      if (!rows[0]) return this.snapshot(tx, set);
      const revision = set.revision + 1;
      await tx.update(sitePatches).set({ deletedAt: null }).where(and(
        eq(sitePatches.projectId, projectId), eq(sitePatches.id, rows[0].id),
      ));
      await tx.update(sitePatchSets).set({ revision }).where(eq(sitePatchSets.id, set.id));
      return this.snapshot(tx, { ...set, revision });
    });
  }

  async rejectDraft(projectId: string, route: string, baseRevision: number): Promise<SitePatchSnapshot> {
    return this.db.transaction(async (tx) => {
      const set = await this.lockPatchSetByRoute(tx, projectId, route);
      this.assertRevision(set, baseRevision);
      const rows = await tx.select({ id: sitePatches.id }).from(sitePatches).where(and(
        eq(sitePatches.projectId, projectId), eq(sitePatches.patchSetId, set.id), eq(sitePatches.state, 'draft'),
      )).limit(1).for('update');
      if (!rows[0]) return this.snapshot(tx, set);
      await tx.delete(sitePatches).where(and(
        eq(sitePatches.projectId, projectId), eq(sitePatches.patchSetId, set.id), eq(sitePatches.state, 'draft'),
      ));
      const revision = set.revision + 1;
      await tx.update(sitePatchSets).set({ revision }).where(eq(sitePatchSets.id, set.id));
      return this.snapshot(tx, { ...set, revision });
    });
  }

  async queueDraftPublish(input: CreateProjectEditJobRecord & { readonly baseRevision: number }): Promise<{ readonly job: ProjectEditJob; readonly snapshot: SitePatchSnapshot }> {
    return this.db.transaction(async (tx) => {
      const { baseRevision, locator, computedStyles, ...jobInput } = input;
      const set = await this.lockPatchSetByRoute(tx, input.projectId, input.route);
      this.assertRevision(set, baseRevision);
      const drafts = await tx.select({ id: sitePatches.id }).from(sitePatches).where(and(
        eq(sitePatches.projectId, input.projectId), eq(sitePatches.patchSetId, set.id),
        eq(sitePatches.state, 'draft'), isNull(sitePatches.deletedAt),
      )).for('update');
      if (!drafts.length) throw new SiteEditorPatchNotFoundError();
      await tx.insert(projectEditJobs).values({
        ...jobInput,
        locatorJson: JSON.stringify(locator),
        computedStylesJson: JSON.stringify(computedStyles),
      });
      await tx.update(sitePatches).set({ state: 'queued', publishJobId: input.id }).where(and(
        eq(sitePatches.projectId, input.projectId), eq(sitePatches.patchSetId, set.id),
        eq(sitePatches.state, 'draft'), isNull(sitePatches.deletedAt),
      ));
      await tx.delete(sitePatches).where(and(
        eq(sitePatches.projectId, input.projectId), eq(sitePatches.patchSetId, set.id),
        eq(sitePatches.state, 'draft'), isNotNull(sitePatches.deletedAt),
      ));
      const revision = set.revision + 1;
      await tx.update(sitePatchSets).set({ revision }).where(eq(sitePatchSets.id, set.id));
      const jobs = await tx.select().from(projectEditJobs).where(and(
        eq(projectEditJobs.projectId, input.projectId), eq(projectEditJobs.id, input.id),
      )).limit(1);
      if (!jobs[0]) throw new Error('Failed to read queued site editor publish job');
      return { job: toJob(jobs[0]), snapshot: await this.snapshot(tx, { ...set, revision }) };
    });
  }

  async hasQueuedPublishJob(projectId: string, jobId: string): Promise<boolean> {
    const rows = await this.db.select({ id: sitePatches.id }).from(sitePatches).where(and(
      eq(sitePatches.projectId, projectId), eq(sitePatches.publishJobId, jobId), eq(sitePatches.state, 'queued'),
    )).limit(1);
    return Boolean(rows[0]);
  }

  async createJob(input: CreateProjectEditJobRecord): Promise<ProjectEditJob> {
    const { locator, computedStyles, ...jobInput } = input;
    await this.db.insert(projectEditJobs).values({
      ...jobInput,
      locatorJson: JSON.stringify(locator),
      computedStylesJson: JSON.stringify(computedStyles),
    }).onDuplicateKeyUpdate({
      set: { idempotencyKey: sql`${projectEditJobs.idempotencyKey}` },
    });
    const rows = await this.db.select().from(projectEditJobs).where(and(
      eq(projectEditJobs.projectId, input.projectId),
      eq(projectEditJobs.createdBy, input.createdBy),
      eq(projectEditJobs.idempotencyKey, input.idempotencyKey),
    )).limit(1);
    const job = rows[0] ? toJob(rows[0]) : null;
    if (!job) throw new Error('Failed to read project edit job');
    return job;
  }

  async getJob(projectId: string, jobId: string): Promise<ProjectEditJob | null> {
    const rows = await this.db.select().from(projectEditJobs).where(and(
      eq(projectEditJobs.projectId, projectId), eq(projectEditJobs.id, jobId),
    )).limit(1);
    return rows[0] ? toJob(rows[0]) : null;
  }

  async listQueuedJobs(projectId: string, dispatcherUserId: string, limit: number): Promise<readonly ProjectEditJob[]> {
    const rows = await this.db.select().from(projectEditJobs).where(and(
      eq(projectEditJobs.projectId, projectId),
      eq(projectEditJobs.dispatcherUserId, dispatcherUserId),
      eq(projectEditJobs.status, 'queued'),
    )).orderBy(asc(projectEditJobs.createdAt)).limit(limit);
    return rows.map(toJob);
  }

  async claimJob(projectId: string, jobId: string, dispatcherUserId: string, claimedAt: Date): Promise<ProjectEditJob | null> {
    const result = await this.db.update(projectEditJobs).set({ status: 'running', claimedAt }).where(and(
      eq(projectEditJobs.projectId, projectId),
      eq(projectEditJobs.id, jobId),
      eq(projectEditJobs.dispatcherUserId, dispatcherUserId),
      eq(projectEditJobs.status, 'queued'),
    ));
    return Number(result[0].affectedRows) > 0 ? this.getJob(projectId, jobId) : null;
  }

  async completeJob(input: {
    projectId: string;
    jobId: string;
    dispatcherUserId: string;
    status: 'succeeded' | 'failed';
    result: Readonly<Record<string, unknown>> | null;
    error: string | null;
    finishedAt: Date;
  }): Promise<ProjectEditJob | null> {
    return this.db.transaction(async (tx) => {
      const jobs = await tx.select().from(projectEditJobs).where(and(
        eq(projectEditJobs.projectId, input.projectId), eq(projectEditJobs.id, input.jobId),
        eq(projectEditJobs.dispatcherUserId, input.dispatcherUserId), eq(projectEditJobs.status, 'running'),
      )).limit(1).for('update');
      if (!jobs[0]) return null;
      await tx.update(projectEditJobs).set({
        status: input.status,
        resultJson: input.result ? JSON.stringify(input.result) : null,
        error: input.error,
        finishedAt: input.finishedAt,
      }).where(and(eq(projectEditJobs.projectId, input.projectId), eq(projectEditJobs.id, input.jobId)));
      const setRows = await tx.select().from(sitePatchSets).where(and(
        eq(sitePatchSets.projectId, input.projectId), eq(sitePatchSets.route, jobs[0].route),
      )).limit(1).for('update');
      if (setRows[0]) {
        const queued = await tx.select({ id: sitePatches.id }).from(sitePatches).where(and(
          eq(sitePatches.projectId, input.projectId), eq(sitePatches.publishJobId, input.jobId), eq(sitePatches.state, 'queued'),
        )).limit(1).for('update');
        if (queued[0]) {
          if (input.status === 'succeeded') {
            await tx.delete(sitePatches).where(and(eq(sitePatches.projectId, input.projectId), eq(sitePatches.publishJobId, input.jobId)));
          } else {
            await tx.update(sitePatches).set({ state: 'draft', publishJobId: null }).where(and(
              eq(sitePatches.projectId, input.projectId), eq(sitePatches.publishJobId, input.jobId),
            ));
          }
          await tx.update(sitePatchSets).set({ revision: setRows[0].revision + 1 }).where(eq(sitePatchSets.id, setRows[0].id));
        }
      }
      const completed = await tx.select().from(projectEditJobs).where(and(
        eq(projectEditJobs.projectId, input.projectId), eq(projectEditJobs.id, input.jobId),
      )).limit(1);
      return completed[0] ? toJob(completed[0]) : null;
    });
  }

  private async lockOrCreatePatchSet(tx: Tx, projectId: string, route: string, seedId: string): Promise<PatchSetRow> {
    await tx.insert(sitePatchSets).values({ id: seedId, projectId, route }).onDuplicateKeyUpdate({
      set: { projectId: sql`${sitePatchSets.projectId}` },
    });
    const rows = await tx.select().from(sitePatchSets).where(and(
      eq(sitePatchSets.projectId, projectId), eq(sitePatchSets.route, route),
    )).limit(1).for('update');
    if (!rows[0]) throw new Error('Failed to lock site patch set');
    return rows[0];
  }

  private async lockPatchSet(tx: Tx, projectId: string, patchSetId: string): Promise<PatchSetRow> {
    const rows = await tx.select().from(sitePatchSets).where(and(
      eq(sitePatchSets.projectId, projectId), eq(sitePatchSets.id, patchSetId),
    )).limit(1).for('update');
    if (!rows[0]) throw new SiteEditorPatchNotFoundError();
    return rows[0];
  }

  private async lockPatchSetByRoute(tx: Tx, projectId: string, route: string): Promise<PatchSetRow> {
    const rows = await tx.select().from(sitePatchSets).where(and(
      eq(sitePatchSets.projectId, projectId), eq(sitePatchSets.route, route),
    )).limit(1).for('update');
    if (!rows[0]) throw new SiteEditorRevisionConflictError(0);
    return rows[0];
  }

  private assertRevision(set: PatchSetRow, baseRevision: number): void {
    if (set.revision !== baseRevision) throw new SiteEditorRevisionConflictError(set.revision);
  }

  private async snapshot(db: Database | Tx, set: PatchSetRow): Promise<SitePatchSnapshot> {
    const rows = await db.select().from(sitePatches).where(and(
      eq(sitePatches.projectId, set.projectId),
      eq(sitePatches.patchSetId, set.id),
      isNull(sitePatches.deletedAt),
    )).orderBy(asc(sitePatches.createdRevision), asc(sitePatches.createdAt));
    const redoRows = await db.select({ id: sitePatches.id }).from(sitePatches).where(and(
      eq(sitePatches.projectId, set.projectId), eq(sitePatches.patchSetId, set.id),
      eq(sitePatches.state, 'draft'), isNotNull(sitePatches.deletedAt),
    ));
    const patches = rows.map(toPatch);
    const draftCount = patches.filter((patch) => patch.state === 'draft').length;
    const queued = patches.filter((patch) => patch.state === 'queued');
    return {
      revision: set.revision,
      patches,
      draftCount,
      redoCount: redoRows.length,
      queuedCount: queued.length,
      publishJobId: queued[0]?.publishJobId ?? null,
    };
  }
}
