import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type {
  ProjectEditJob,
  SiteEditorSession,
  SitePatch,
  SitePatchSnapshot,
} from '../../domain/site-editor/SiteEditor.js';
import {
  SiteEditorArtifactConflictError,
  SiteEditorRevisionConflictError,
  SiteEditorValidationError,
} from '../../domain/site-editor/errors.js';
import type {
  CreatePatchRecord,
  CreateProjectEditJobRecord,
  CreateSessionRecord,
  SiteEditorRepository,
  UpdatePatchRecord,
} from './SiteEditorRepository.js';
import { SiteEditorService } from './SiteEditorService.js';
import { redactDomSnapshot, sanitizeLocator, sanitizePatchPayload } from './sanitizeSiteEditorInput.js';

const PROJECT_ID = 'project-a';
const OTHER_PROJECT_ID = 'project-b';
const EDITOR_ID = 'editor';
const DISPATCHER_ID = 'dispatcher';
const ARTIFACT_VERSION = '2026-07-18T10:00:00.000Z';

const locator = {
  cssPath: '[data-pf-id="hero-title"]',
  tagName: 'h1',
  stableAttributes: { 'data-pf-id': 'hero-title' },
};

class InMemorySiteEditorRepository implements SiteEditorRepository {
  readonly sessions: SiteEditorSession[] = [];
  readonly jobs = new Map<string, ProjectEditJob>();
  private readonly snapshots = new Map<string, SitePatchSnapshot>();
  private readonly patches = new Map<string, SitePatch>();

  async createSession(input: CreateSessionRecord): Promise<SiteEditorSession> {
    const session: SiteEditorSession = { ...input, revokedAt: null, createdAt: new Date() };
    this.sessions.push(session);
    return session;
  }

  async findSessionByTokenHash(projectId: string, tokenHash: string): Promise<SiteEditorSession | null> {
    return this.sessions.find((item) => item.projectId === projectId && item.tokenHash === tokenHash) ?? null;
  }

  async getSession(projectId: string, sessionId: string): Promise<SiteEditorSession | null> {
    return this.sessions.find((item) => item.projectId === projectId && item.id === sessionId) ?? null;
  }

  async revokeSession(projectId: string, sessionId: string, revokedAt: Date): Promise<boolean> {
    const index = this.sessions.findIndex((item) => item.projectId === projectId && item.id === sessionId);
    if (index < 0) return false;
    this.sessions[index] = { ...this.sessions[index]!, revokedAt };
    return true;
  }

  async getPatches(projectId: string, route: string): Promise<SitePatchSnapshot> {
    return this.snapshots.get(`${projectId}:${route}`) ?? { revision: 0, patches: [] };
  }

  async createPatch(input: CreatePatchRecord): Promise<SitePatchSnapshot> {
    const key = `${input.projectId}:${input.route}`;
    const current = await this.getPatches(input.projectId, input.route);
    const replay = current.patches.find((item) => item.idempotencyKey === input.idempotencyKey);
    if (replay) return current;
    if (input.baseRevision !== current.revision) throw new SiteEditorRevisionConflictError(current.revision);
    const now = new Date();
    const patch: SitePatch = {
      id: input.id,
      projectId: input.projectId,
      patchSetId: key,
      locator: input.locator,
      kind: input.kind,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      createdRevision: current.revision + 1,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    const next = { revision: current.revision + 1, patches: [...current.patches, patch] };
    this.patches.set(patch.id, patch);
    this.snapshots.set(key, next);
    return next;
  }

  async getPatch(projectId: string, patchId: string): Promise<SitePatch | null> {
    const patch = this.patches.get(patchId);
    return patch?.projectId === projectId ? patch : null;
  }

  async updatePatch(input: UpdatePatchRecord): Promise<SitePatchSnapshot> {
    const patch = await this.getPatch(input.projectId, input.patchId);
    if (!patch) throw new Error('not found');
    const snapshot = [...this.snapshots.values()].find((item) => item.patches.some((entry) => entry.id === patch.id))!;
    if (snapshot.revision !== input.baseRevision) throw new SiteEditorRevisionConflictError(snapshot.revision);
    const updated = { ...patch, locator: input.locator, kind: input.kind, payload: input.payload, updatedAt: new Date() };
    const next = {
      revision: snapshot.revision + 1,
      patches: snapshot.patches.map((entry) => entry.id === patch.id ? updated : entry),
    };
    this.patches.set(patch.id, updated);
    this.snapshots.set(patch.patchSetId, next);
    return next;
  }

  async deletePatch(projectId: string, patchId: string, baseRevision: number): Promise<SitePatchSnapshot> {
    const patch = await this.getPatch(projectId, patchId);
    if (!patch) throw new Error('not found');
    const snapshot = this.snapshots.get(patch.patchSetId)!;
    if (snapshot.revision !== baseRevision) throw new SiteEditorRevisionConflictError(snapshot.revision);
    const next = { revision: snapshot.revision + 1, patches: snapshot.patches.filter((item) => item.id !== patchId) };
    this.snapshots.set(patch.patchSetId, next);
    this.patches.delete(patchId);
    return next;
  }

  async undoPatch(projectId: string, route: string, baseRevision: number): Promise<SitePatchSnapshot> {
    const current = await this.getPatches(projectId, route);
    if (current.revision !== baseRevision) throw new SiteEditorRevisionConflictError(current.revision);
    const next = { revision: current.revision + 1, patches: current.patches.slice(0, -1) };
    this.snapshots.set(`${projectId}:${route}`, next);
    return next;
  }

  async redoPatch(projectId: string, route: string, baseRevision: number): Promise<SitePatchSnapshot> {
    const current = await this.getPatches(projectId, route);
    if (current.revision !== baseRevision) throw new SiteEditorRevisionConflictError(current.revision);
    return current;
  }

  async createJob(input: CreateProjectEditJobRecord): Promise<ProjectEditJob> {
    const now = new Date();
    const job: ProjectEditJob = {
      ...input,
      status: 'queued',
      result: null,
      error: null,
      claimedAt: null,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  async getJob(projectId: string, jobId: string): Promise<ProjectEditJob | null> {
    const job = this.jobs.get(jobId);
    return job?.projectId === projectId ? job : null;
  }

  async listQueuedJobs(projectId: string, dispatcherUserId: string, limit: number): Promise<readonly ProjectEditJob[]> {
    return [...this.jobs.values()]
      .filter((job) => job.projectId === projectId && job.dispatcherUserId === dispatcherUserId && job.status === 'queued')
      .slice(0, limit);
  }

  async claimJob(projectId: string, jobId: string, dispatcherUserId: string, claimedAt: Date): Promise<ProjectEditJob | null> {
    const job = await this.getJob(projectId, jobId);
    if (!job || job.dispatcherUserId !== dispatcherUserId || job.status !== 'queued') return null;
    const claimed: ProjectEditJob = { ...job, status: 'running', claimedAt, updatedAt: claimedAt };
    this.jobs.set(job.id, claimed);
    return claimed;
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
    const job = await this.getJob(input.projectId, input.jobId);
    if (!job || job.dispatcherUserId !== input.dispatcherUserId || job.status !== 'running') return null;
    const completed: ProjectEditJob = {
      ...job,
      status: input.status,
      result: input.result,
      error: input.error,
      finishedAt: input.finishedAt,
      updatedAt: input.finishedAt,
    };
    this.jobs.set(job.id, completed);
    return completed;
  }
}

function createFixture() {
  const repository = new InMemorySiteEditorRepository();
  let currentTime = new Date('2026-07-18T10:00:00.000Z');
  let currentArtifact = ARTIFACT_VERSION;
  let sequence = 0;
  const project = {
    id: PROJECT_ID,
    dispatcherUserId: DISPATCHER_ID,
  };
  const service = new SiteEditorService({
    repository,
    projects: {
      getById: async (projectId: string) => projectId === PROJECT_ID ? project : null,
    } as never,
    members: {
      findForProject: async (projectId: string, userId: string) =>
        projectId === PROJECT_ID && [EDITOR_ID, DISPATCHER_ID].includes(userId)
          ? { projectId, userId, role: 'editor', joinedAt: new Date() }
          : null,
    } as never,
    sites: {
      getByProject: async (projectId: string) => projectId === PROJECT_ID
        ? { projectId, publishedAt: new Date(currentArtifact) }
        : null,
    } as never,
    idGen: () => `id-${++sequence}`,
    tokenGen: () => 'plain-session-token',
    hashToken: (token) => createHash('sha256').update(token).digest('hex'),
    now: () => currentTime,
  });
  return {
    repository,
    service,
    setTime(value: string) { currentTime = new Date(value); },
    setArtifact(value: string) { currentArtifact = value; },
  };
}

test('editor sessions are hashed, project-isolated, expiring and revocable', async () => {
  const fixture = createFixture();
  const session = await fixture.service.createSession(PROJECT_ID, EDITOR_ID);
  assert.notEqual(fixture.repository.sessions[0]!.tokenHash, session.token);
  assert.equal(await fixture.service.validateBridgeSession(PROJECT_ID, session.token), true);
  assert.equal(await fixture.service.validateBridgeSession(OTHER_PROJECT_ID, session.token), false);

  fixture.setTime('2026-07-18T10:15:00.001Z');
  assert.equal(await fixture.service.validateBridgeSession(PROJECT_ID, session.token), false);

  fixture.setTime('2026-07-18T10:00:00.000Z');
  await fixture.service.revokeSession(PROJECT_ID, EDITOR_ID, session.id);
  assert.equal(await fixture.service.validateBridgeSession(PROJECT_ID, session.token), false);
});

test('patch create is idempotent and rejects stale optimistic revisions', async () => {
  const fixture = createFixture();
  const input = {
    projectId: PROJECT_ID,
    userId: EDITOR_ID,
    route: '/catalog?sort=new#top',
    baseRevision: 0,
    idempotencyKey: 'request-0001',
    patch: { locator, kind: 'text' as const, payload: { text: 'Новый заголовок' } },
  };
  const created = await fixture.service.createPatch(input);
  const replay = await fixture.service.createPatch(input);
  assert.equal(created.revision, 1);
  assert.equal(replay.revision, 1);
  assert.equal(replay.patches.length, 1);

  await assert.rejects(
    fixture.service.createPatch({ ...input, idempotencyKey: 'request-0002' }),
    (error: unknown) => error instanceof SiteEditorRevisionConflictError && error.currentRevision === 1,
  );
});

test('patch sanitization rejects script/event/javascript/raw CSS payloads and redacts DOM secrets', () => {
  assert.throws(
    () => sanitizeLocator({ ...locator, stableAttributes: { onclick: 'steal()' } }),
    SiteEditorValidationError,
  );
  assert.throws(
    () => sanitizePatchPayload('attribute', { name: 'href', value: 'javascript:alert(1)' }),
    SiteEditorValidationError,
  );
  assert.throws(
    () => sanitizePatchPayload('style', { styles: { color: 'red; position: fixed' } }),
    SiteEditorValidationError,
  );
  const redacted = redactDomSnapshot(
    '<script>steal()</script><input value="secret"><p>api_key=abc123456 user@example.com +7 999 123-45-67</p>',
  );
  assert.doesNotMatch(redacted, /steal|abc123456|user@example\.com|999 123/);
  assert.match(redacted, /\[redacted\]/);
});

test('edit jobs redact context and enforce artifact versions for creation and dispatcher claims', async () => {
  const fixture = createFixture();
  const job = await fixture.service.createJob({
    projectId: PROJECT_ID,
    userId: EDITOR_ID,
    route: '/catalog',
    locator,
    domSnapshot: '<div>authorization=top-secret user@example.com</div>',
    computedStyles: { color: '#111111', backgroundImage: 'url(https://bad.example)' },
    prompt: 'Исправь блок, api_key=top-secret',
    operation: 'regenerate_section',
    artifactVersion: ARTIFACT_VERSION,
  });
  assert.doesNotMatch(job.domSnapshot, /top-secret|user@example\.com/);
  assert.doesNotMatch(job.prompt, /top-secret/);
  assert.deepEqual(job.computedStyles, { color: '#111111' });

  fixture.setArtifact('2026-07-18T11:00:00.000Z');
  await assert.rejects(
    fixture.service.claimJob(PROJECT_ID, DISPATCHER_ID, job.id, ARTIFACT_VERSION),
    SiteEditorArtifactConflictError,
  );
});
