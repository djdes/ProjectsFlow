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
  }): Promise<ProjectEditJob> {
    const { project } = await requireProjectAccess(this.deps, input.projectId, input.userId, 'update_project');
    if (!project.dispatcherUserId) throw new ProjectEditDispatcherMissingError();
    await this.assertArtifactVersion(input.projectId, input.artifactVersion);
    return this.deps.repository.createJob({
      id: this.deps.idGen(),
      projectId: input.projectId,
      createdBy: input.userId,
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
    if (existing.artifactVersion !== input.artifactVersion) {
      throw new SiteEditorArtifactConflictError(await this.currentArtifactVersion(input.projectId));
    }
    await this.assertArtifactVersion(input.projectId, input.artifactVersion);
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
