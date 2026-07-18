import { createHash, randomBytes } from 'node:crypto';
import type { ProjectAccessDeps } from '../project/projectAccess.js';
import { requireDispatcherAccess, requireProjectAccess } from '../project/projectAccess.js';
import type { SiteArtifactRepository } from '../site/SiteArtifactRepository.js';
import type {
  ProjectEditJob,
  ProjectEditOperation,
  SiteEditorSession,
  SiteElementLocator,
  SitePatchKind,
  SitePatchSnapshot,
} from '../../domain/site-editor/SiteEditor.js';
import {
  ProjectEditDispatcherMissingError,
  ProjectEditJobNotFoundError,
  ProjectEditJobStateError,
  SiteEditorArtifactConflictError,
  SiteEditorNotDeployedError,
  SiteEditorPatchNotFoundError,
  SiteEditorSessionInvalidError,
  SiteEditorValidationError,
} from '../../domain/site-editor/errors.js';
import type { SiteEditorRepository } from './SiteEditorRepository.js';
import {
  normalizeSiteRoute,
  redactDomSnapshot,
  redactSensitiveText,
  sanitizeComputedStyles,
  sanitizeLocator,
  sanitizePatchPayload,
} from './sanitizeSiteEditorInput.js';

type Deps = ProjectAccessDeps & {
  readonly repository: SiteEditorRepository;
  readonly sites: SiteArtifactRepository;
  readonly idGen: () => string;
  readonly tokenGen?: () => string;
  readonly hashToken?: (token: string) => string;
  readonly now?: () => Date;
};

const SESSION_TTL_MS = 15 * 60 * 1000;

function normalizeJobResultPatch(candidate: unknown): { kind: SitePatchKind; payload: Readonly<Record<string, unknown>> } | null {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const patch = candidate as Record<string, unknown>;
  const kind = patch['kind'];
  if (!['text', 'style', 'attribute', 'visibility', 'command'].includes(String(kind))) {
    throw new SiteEditorValidationError('Invalid result patch kind');
  }
  if (patch['payload'] && typeof patch['payload'] === 'object' && !Array.isArray(patch['payload'])) {
    return { kind: kind as SitePatchKind, payload: patch['payload'] as Record<string, unknown> };
  }
  if (kind === 'text' && typeof patch['value'] === 'string') return { kind, payload: { text: patch['value'] } };
  if (kind === 'style' && typeof patch['property'] === 'string' && typeof patch['value'] === 'string') {
    return { kind, payload: { styles: { [patch['property']]: patch['value'] } } };
  }
  if (kind === 'attribute' && typeof patch['name'] === 'string' && (typeof patch['value'] === 'string' || patch['value'] === null)) {
    return { kind, payload: { name: patch['name'], value: patch['value'] } };
  }
  if (kind === 'visibility' && typeof patch['hidden'] === 'boolean') return { kind, payload: { hidden: patch['hidden'] } };
  if (kind === 'command' && typeof patch['command'] === 'string') return { kind, payload: { command: patch['command'] } };
  throw new SiteEditorValidationError('Invalid result patch payload');
}

export class SiteEditorService {
  private readonly now: () => Date;
  private readonly tokenGen: () => string;
  private readonly hashToken: (token: string) => string;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? (() => new Date());
    this.tokenGen = deps.tokenGen ?? (() => randomBytes(32).toString('base64url'));
    this.hashToken = deps.hashToken ?? ((token) => createHash('sha256').update(token).digest('hex'));
  }

  async createSession(projectId: string, userId: string, route = '/'): Promise<{
    id: string;
    token: string;
    expiresAt: Date;
    artifactVersion: string;
  }> {
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    const artifactVersion = await this.requireArtifactVersion(projectId);
    const token = this.tokenGen();
    const expiresAt = new Date(this.now().getTime() + SESSION_TTL_MS);
    const session = await this.deps.repository.createSession({
      id: this.deps.idGen(),
      projectId,
      userId,
      tokenHash: this.hashToken(token),
      route: normalizeSiteRoute(route),
      artifactVersion,
      expiresAt,
    });
    return { id: session.id, token, expiresAt: session.expiresAt, artifactVersion };
  }

  async revokeSession(projectId: string, userId: string, sessionId: string): Promise<void> {
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    await this.deps.repository.revokeSession(projectId, sessionId, this.now());
  }

  async requireSession(projectId: string, userId: string, sessionId: string): Promise<SiteEditorSession> {
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    const session = await this.deps.repository.getSession(projectId, sessionId);
    if (!session || session.userId !== userId || session.revokedAt || session.expiresAt.getTime() <= this.now().getTime()) {
      throw new SiteEditorSessionInvalidError();
    }
    await this.assertArtifactVersion(projectId, session.artifactVersion);
    return session;
  }

  async validateBridgeSession(projectId: string, token: string): Promise<boolean> {
    if (!token || token.length > 256) return false;
    const session = await this.deps.repository.findSessionByTokenHash(projectId, this.hashToken(token));
    if (!session || session.revokedAt || session.expiresAt.getTime() <= this.now().getTime()) return false;
    const current = await this.currentArtifactVersion(projectId);
    return current !== null && current === session.artifactVersion;
  }

  async getPatches(projectId: string, userId: string, route: string): Promise<SitePatchSnapshot> {
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    return this.deps.repository.getPatches(projectId, normalizeSiteRoute(route));
  }

  async createPatch(input: {
    projectId: string;
    userId: string;
    route: string;
    baseRevision: number;
    idempotencyKey: string;
    patch: { locator: SiteElementLocator; kind: SitePatchKind; payload: Readonly<Record<string, unknown>> };
  }): Promise<SitePatchSnapshot> {
    await requireProjectAccess(this.deps, input.projectId, input.userId, 'update_project');
    return this.deps.repository.createPatch({
      id: this.deps.idGen(),
      projectId: input.projectId,
      route: normalizeSiteRoute(input.route),
      baseRevision: input.baseRevision,
      idempotencyKey: input.idempotencyKey,
      locator: sanitizeLocator(input.patch.locator),
      kind: input.patch.kind,
      payload: sanitizePatchPayload(input.patch.kind, input.patch.payload),
      createdBy: input.userId,
    });
  }

  async updatePatch(input: {
    projectId: string;
    userId: string;
    patchId: string;
    baseRevision: number;
    patch: { locator?: SiteElementLocator; kind?: SitePatchKind; payload?: Readonly<Record<string, unknown>> };
  }): Promise<SitePatchSnapshot> {
    await requireProjectAccess(this.deps, input.projectId, input.userId, 'update_project');
    const current = await this.deps.repository.getPatch(input.projectId, input.patchId);
    if (!current) throw new SiteEditorPatchNotFoundError();
    const locator = sanitizeLocator(input.patch.locator ?? current.locator);
    const kind = input.patch.kind ?? current.kind;
    const payload = sanitizePatchPayload(kind, input.patch.payload ?? current.payload);
    return this.deps.repository.updatePatch({
      projectId: input.projectId,
      patchId: input.patchId,
      baseRevision: input.baseRevision,
      locator,
      kind,
      payload,
    });
  }

  async deletePatch(
    projectId: string,
    userId: string,
    patchId: string,
    baseRevision: number,
  ): Promise<SitePatchSnapshot> {
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    return this.deps.repository.deletePatch(projectId, patchId, baseRevision);
  }

  async undoSessionPatch(projectId: string, userId: string, sessionId: string, baseRevision: number): Promise<SitePatchSnapshot> {
    const session = await this.requireSession(projectId, userId, sessionId);
    return this.deps.repository.undoPatch(projectId, session.route, baseRevision);
  }

  async redoSessionPatch(projectId: string, userId: string, sessionId: string, baseRevision: number): Promise<SitePatchSnapshot> {
    const session = await this.requireSession(projectId, userId, sessionId);
    return this.deps.repository.redoPatch(projectId, session.route, baseRevision);
  }

  async rejectSessionDraft(projectId: string, userId: string, sessionId: string, baseRevision: number): Promise<SitePatchSnapshot> {
    const session = await this.requireSession(projectId, userId, sessionId);
    return this.deps.repository.rejectDraft(projectId, session.route, baseRevision);
  }

  async queueSessionDraftPublish(projectId: string, userId: string, sessionId: string, baseRevision: number): Promise<{ readonly job: ProjectEditJob; readonly snapshot: SitePatchSnapshot }> {
    const session = await this.requireSession(projectId, userId, sessionId);
    const { project } = await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    if (!project.dispatcherUserId) throw new ProjectEditDispatcherMissingError();
    const snapshot = await this.deps.repository.getPatches(projectId, session.route);
    const drafts = snapshot.patches.filter((patch) => patch.state === 'draft');
    if (!drafts.length) throw new SiteEditorPatchNotFoundError();
    const context = JSON.stringify({
      protocol: 'projectsflow.site-editor-publish.v1',
      route: session.route,
      baseArtifactVersion: session.artifactVersion,
      patches: drafts.map((patch) => ({
        id: patch.id,
        locator: patch.locator,
        kind: patch.kind,
        payload: patch.payload,
        createdRevision: patch.createdRevision,
      })),
    }).slice(0, 50_000);
    return this.deps.repository.queueDraftPublish({
      id: this.deps.idGen(),
      projectId,
      createdBy: userId,
      idempotencyKey: `publish:${session.id}:${baseRevision}`.slice(0, 100),
      dispatcherUserId: project.dispatcherUserId,
      operation: 'edit_code',
      route: session.route,
      locator: drafts[0]!.locator,
      domSnapshot: context,
      computedStyles: {},
      prompt: 'Apply the approved ProjectsFlow visual-editor patch batch to the project source. Preserve unrelated code, run relevant checks, commit and push the change, deploy it, then complete this job only after a new deployment artifact is available.',
      artifactVersion: session.artifactVersion,
      baseRevision,
    });
  }

  async createJob(input: {
    projectId: string;
    userId: string;
    route: string;
    locator: SiteElementLocator;
    domSnapshot: string;
    computedStyles: Readonly<Record<string, string>>;
    prompt: string;
    operation: ProjectEditOperation;
    artifactVersion: string;
    idempotencyKey: string;
  }): Promise<ProjectEditJob> {
    const { project } = await requireProjectAccess(this.deps, input.projectId, input.userId, 'update_project');
    if (!project.dispatcherUserId) throw new ProjectEditDispatcherMissingError();
    await this.assertArtifactVersion(input.projectId, input.artifactVersion);
    if (!/^[A-Za-z0-9._:-]{8,100}$/.test(input.idempotencyKey)) {
      throw new SiteEditorValidationError('Invalid edit job idempotency key');
    }
    return this.deps.repository.createJob({
      id: this.deps.idGen(),
      projectId: input.projectId,
      createdBy: input.userId,
      idempotencyKey: input.idempotencyKey,
      dispatcherUserId: project.dispatcherUserId,
      operation: input.operation,
      route: normalizeSiteRoute(input.route),
      locator: sanitizeLocator(input.locator),
      domSnapshot: redactDomSnapshot(input.domSnapshot),
      computedStyles: sanitizeComputedStyles(input.computedStyles),
      prompt: redactSensitiveText(input.prompt).slice(0, 4000),
      artifactVersion: input.artifactVersion,
    });
  }

  async getJob(projectId: string, userId: string, jobId: string): Promise<ProjectEditJob> {
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    const job = await this.deps.repository.getJob(projectId, jobId);
    if (!job) throw new ProjectEditJobNotFoundError();
    return job;
  }

  async listQueuedJobs(projectId: string, userId: string, limit = 20): Promise<readonly ProjectEditJob[]> {
    await requireDispatcherAccess(this.deps, projectId, userId);
    return this.deps.repository.listQueuedJobs(projectId, userId, Math.max(1, Math.min(50, limit)));
  }

  async claimJob(projectId: string, userId: string, jobId: string, artifactVersion: string): Promise<ProjectEditJob> {
    await requireDispatcherAccess(this.deps, projectId, userId);
    const existing = await this.requireJob(projectId, jobId);
    if (existing.artifactVersion !== artifactVersion) {
      throw new SiteEditorArtifactConflictError(await this.currentArtifactVersion(projectId));
    }
    await this.assertArtifactVersion(projectId, artifactVersion);
    const claimed = await this.deps.repository.claimJob(projectId, jobId, userId, this.now());
    if (!claimed) throw new ProjectEditJobStateError('Edit job is no longer queued');
    return claimed;
  }

  async completeJob(input: {
    projectId: string;
    userId: string;
    jobId: string;
    artifactVersion: string;
    status: 'succeeded' | 'failed';
    result?: Readonly<Record<string, unknown>> | null;
    error?: string | null;
  }): Promise<ProjectEditJob> {
    await requireDispatcherAccess(this.deps, input.projectId, input.userId);
    const existing = await this.requireJob(input.projectId, input.jobId);
    const currentArtifactVersion = await this.currentArtifactVersion(input.projectId);
    const isDraftPublish = await this.deps.repository.hasQueuedPublishJob(input.projectId, input.jobId);
    if (input.status === 'succeeded') {
      // A publish/edit job is complete only when the worker has produced a newer
      // artifact. This prevents dropping the replay overlay before the source-backed
      // result can replace it.
      if (!currentArtifactVersion || input.artifactVersion !== currentArtifactVersion || (isDraftPublish && currentArtifactVersion === existing.artifactVersion)) {
        throw new SiteEditorArtifactConflictError(currentArtifactVersion);
      }
    } else if (input.artifactVersion !== existing.artifactVersion) {
      throw new SiteEditorArtifactConflictError(currentArtifactVersion);
    }
    if (input.status === 'succeeded' && !isDraftPublish) {
      const patch = normalizeJobResultPatch(input.result?.['patch']);
      if (patch) {
        const snapshot = await this.deps.repository.getPatches(input.projectId, existing.route);
        await this.deps.repository.createPatch({
          id: this.deps.idGen(),
          projectId: input.projectId,
          route: existing.route,
          baseRevision: snapshot.revision,
          idempotencyKey: `job:${existing.id}`,
          locator: sanitizeLocator(existing.locator),
          kind: patch.kind,
          payload: sanitizePatchPayload(patch.kind, patch.payload),
          createdBy: existing.createdBy,
        });
      }
    }
    const completed = await this.deps.repository.completeJob({
      projectId: input.projectId,
      jobId: input.jobId,
      dispatcherUserId: input.userId,
      status: input.status,
      result: input.result ?? null,
      error: input.status === 'failed' ? redactSensitiveText(input.error ?? 'Edit job failed').slice(0, 500) : null,
      finishedAt: this.now(),
    });
    if (!completed) throw new ProjectEditJobStateError('Edit job is not running');
    return completed;
  }

  async getArtifactVersionForDispatcher(projectId: string, userId: string): Promise<string | null> {
    await requireDispatcherAccess(this.deps, projectId, userId);
    return this.currentArtifactVersion(projectId);
  }

  private async requireJob(projectId: string, jobId: string): Promise<ProjectEditJob> {
    const job = await this.deps.repository.getJob(projectId, jobId);
    if (!job) throw new ProjectEditJobNotFoundError();
    return job;
  }

  private async currentArtifactVersion(projectId: string): Promise<string | null> {
    const artifact = await this.deps.sites.getByProject(projectId);
    return artifact?.publishedAt.toISOString() ?? null;
  }

  private async requireArtifactVersion(projectId: string): Promise<string> {
    const version = await this.currentArtifactVersion(projectId);
    if (!version) throw new SiteEditorNotDeployedError();
    return version;
  }

  private async assertArtifactVersion(projectId: string, expected: string): Promise<void> {
    const current = await this.currentArtifactVersion(projectId);
    if (!current || current !== expected) throw new SiteEditorArtifactConflictError(current);
  }
}
