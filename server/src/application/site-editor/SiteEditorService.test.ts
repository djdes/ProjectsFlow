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
  CloseEditRunChatInput,
  EditRunChatSink,
  OpenEditRunChatInput,
} from './EditRunChatSink.js';
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

function patchSnapshot(revision: number, patches: readonly SitePatch[]): SitePatchSnapshot {
  const active = patches.filter((patch) => patch.state === 'draft' || patch.state === 'queued');
  const queued = active.filter((patch) => patch.state === 'queued');
  return {
    revision,
    patches: active,
    draftCount: active.filter((patch) => patch.state === 'draft').length,
    redoCount: 0,
    queuedCount: queued.length,
    publishJobId: queued[0]?.publishJobId ?? null,
  };
}

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
    return this.snapshots.get(`${projectId}:${route}`) ?? patchSnapshot(0, []);
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
      state: 'draft',
      publishJobId: null,
      createdAt: now,
      updatedAt: now,
    };
    const next = patchSnapshot(current.revision + 1, [...current.patches, patch]);
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
    const next = patchSnapshot(snapshot.revision + 1, snapshot.patches.map((entry) => entry.id === patch.id ? updated : entry));
    this.patches.set(patch.id, updated);
    this.snapshots.set(patch.patchSetId, next);
    return next;
  }

  async deletePatch(projectId: string, patchId: string, baseRevision: number): Promise<SitePatchSnapshot> {
    const patch = await this.getPatch(projectId, patchId);
    if (!patch) throw new Error('not found');
    const snapshot = this.snapshots.get(patch.patchSetId)!;
    if (snapshot.revision !== baseRevision) throw new SiteEditorRevisionConflictError(snapshot.revision);
    const next = patchSnapshot(snapshot.revision + 1, snapshot.patches.filter((item) => item.id !== patchId));
    this.snapshots.set(patch.patchSetId, next);
    this.patches.delete(patchId);
    return next;
  }

  async undoPatch(projectId: string, route: string, baseRevision: number): Promise<SitePatchSnapshot> {
    const current = await this.getPatches(projectId, route);
    if (current.revision !== baseRevision) throw new SiteEditorRevisionConflictError(current.revision);
    const next = patchSnapshot(current.revision + 1, current.patches.slice(0, -1));
    this.snapshots.set(`${projectId}:${route}`, next);
    return next;
  }

  async redoPatch(projectId: string, route: string, baseRevision: number): Promise<SitePatchSnapshot> {
    const current = await this.getPatches(projectId, route);
    if (current.revision !== baseRevision) throw new SiteEditorRevisionConflictError(current.revision);
    return current;
  }

  async rejectDraft(projectId: string, route: string, baseRevision: number): Promise<SitePatchSnapshot> {
    const current = await this.getPatches(projectId, route);
    if (current.revision !== baseRevision) throw new SiteEditorRevisionConflictError(current.revision);
    const next = patchSnapshot(current.revision + 1, current.patches.filter((patch) => patch.state !== 'draft'));
    this.snapshots.set(`${projectId}:${route}`, next);
    return next;
  }

  async queueDraftPublish(input: CreateProjectEditJobRecord & { readonly baseRevision: number }): Promise<{ readonly job: ProjectEditJob; readonly snapshot: SitePatchSnapshot }> {
    const current = await this.getPatches(input.projectId, input.route);
    if (current.revision !== input.baseRevision) throw new SiteEditorRevisionConflictError(current.revision);
    const job = await this.createJob(input);
    const patches = current.patches.map((patch): SitePatch => patch.state === 'draft' ? { ...patch, state: 'queued', publishJobId: job.id } : patch);
    const snapshot = patchSnapshot(current.revision + 1, patches);
    this.snapshots.set(`${input.projectId}:${input.route}`, snapshot);
    return { job, snapshot };
  }

  async hasQueuedPublishJob(projectId: string, jobId: string): Promise<boolean> {
    return [...this.snapshots.entries()].some(([key, snapshot]) => key.startsWith(`${projectId}:`) && snapshot.patches.some((patch) => patch.state === 'queued' && patch.publishJobId === jobId));
  }

  async createJob(input: CreateProjectEditJobRecord): Promise<ProjectEditJob> {
    const existing = [...this.jobs.values()].find((job) =>
      job.projectId === input.projectId
      && job.createdBy === input.createdBy
      && job.idempotencyKey === input.idempotencyKey);
    if (existing) return existing;
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

  async listQueuedJobsForDispatcher(dispatcherUserId: string, limit: number): Promise<readonly ProjectEditJob[]> {
    return [...this.jobs.values()]
      .filter((job) => job.dispatcherUserId === dispatcherUserId && job.status === 'queued')
      .slice(0, limit);
  }

  async listStaleRunningJobs(claimedBefore: Date, limit: number): Promise<readonly ProjectEditJob[]> {
    return [...this.jobs.values()]
      .filter((job) => job.status === 'running' && job.claimedAt !== null && job.claimedAt < claimedBefore)
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
    for (const [key, snapshot] of this.snapshots) {
      const queued = snapshot.patches.some((patch) => patch.publishJobId === job.id && patch.state === 'queued');
      if (!queued) continue;
      const patches = input.status === 'succeeded'
        ? snapshot.patches.filter((patch) => patch.publishJobId !== job.id)
        : snapshot.patches.map((patch): SitePatch => patch.publishJobId === job.id ? { ...patch, state: 'draft', publishJobId: null } : patch);
      this.snapshots.set(key, patchSnapshot(snapshot.revision + 1, patches));
    }
    return completed;
  }
}

// Порт чата вместо всего AiConversationService: редактор обязан уметь работать и без
// чата, поэтому проверяем именно то, что уходит в щель.
class RecordingChatSink implements EditRunChatSink {
  readonly opened: OpenEditRunChatInput[] = [];
  readonly closed: CloseEditRunChatInput[] = [];
  broken = false;

  async openEditRun(input: OpenEditRunChatInput): Promise<void> {
    if (this.broken) throw new Error('chat is unavailable');
    this.opened.push(input);
  }

  async closeEditRun(input: CloseEditRunChatInput): Promise<void> {
    if (this.broken) throw new Error('chat is unavailable');
    this.closed.push(input);
  }
}

function createFixture() {
  const repository = new InMemorySiteEditorRepository();
  const chat = new RecordingChatSink();
  let currentTime = new Date('2026-07-18T10:00:00.000Z');
  let currentArtifact = ARTIFACT_VERSION;
  let sequence = 0;
  const project = {
    id: PROJECT_ID,
    dispatcherUserId: DISPATCHER_ID,
  };
  const service = new SiteEditorService({
    repository,
    chat,
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
    chat,
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
    () => sanitizePatchPayload('attribute', { name: 'href', value: '//evil.example/phishing' }),
    SiteEditorValidationError,
  );
  assert.deepEqual(
    sanitizePatchPayload('attribute', { name: 'href', value: '/catalog?sort=new' }),
    { name: 'href', value: '/catalog?sort=new' },
  );
  assert.throws(
    () => sanitizePatchPayload('style', { styles: { color: 'red; position: fixed' } }),
    SiteEditorValidationError,
  );
  assert.deepEqual(
    sanitizePatchPayload('html', { html: '<section class="hero"><h1>Safe</h1></section>' }),
    { html: '<section class="hero"><h1>Safe</h1></section>' },
  );
  assert.throws(
    () => sanitizePatchPayload('html', { html: '<img src="x" onerror="steal()">' }),
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
    idempotencyKey: 'preview-ai-test-job',
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

test('edit job idempotency returns one queued job for retried submissions', async () => {
  const fixture = createFixture();
  const input = {
    projectId: PROJECT_ID,
    userId: EDITOR_ID,
    route: '/catalog',
    locator,
    domSnapshot: '<div>Catalog</div>',
    computedStyles: { color: '#111111' },
    prompt: 'Сделай каталог компактнее',
    idempotencyKey: 'preview-ai-retry-1',
    operation: 'regenerate_section' as const,
    artifactVersion: ARTIFACT_VERSION,
  };

  const first = await fixture.service.createJob(input);
  const retried = await fixture.service.createJob(input);

  assert.equal(retried.id, first.id);
  assert.equal(fixture.repository.jobs.size, 1);
});

test('approved draft stays replayable until dispatcher publishes a newer artifact', async () => {
  const fixture = createFixture();
  const session = await fixture.service.createSession(PROJECT_ID, EDITOR_ID, '/');
  const draft = await fixture.service.createPatch({
    projectId: PROJECT_ID,
    userId: EDITOR_ID,
    route: '/',
    baseRevision: 0,
    idempotencyKey: 'preview-draft-publish-1',
    patch: { locator, kind: 'text', payload: { text: 'Опубликованный заголовок' } },
  });

  const queued = await fixture.service.queueSessionDraftPublish(PROJECT_ID, EDITOR_ID, session.id, draft.revision);
  assert.equal(queued.snapshot.draftCount, 0);
  assert.equal(queued.snapshot.queuedCount, 1);
  assert.equal(queued.snapshot.patches.length, 1);

  await fixture.service.claimJob(PROJECT_ID, DISPATCHER_ID, queued.job.id, ARTIFACT_VERSION);
  fixture.setArtifact('2026-07-18T10:05:00.000Z');
  await fixture.service.completeJob({
    projectId: PROJECT_ID,
    userId: DISPATCHER_ID,
    jobId: queued.job.id,
    artifactVersion: '2026-07-18T10:05:00.000Z',
    status: 'succeeded',
  });

  const published = await fixture.service.getPatches(PROJECT_ID, EDITOR_ID, '/');
  assert.equal(published.queuedCount, 0);
  assert.equal(published.patches.length, 0);
  // Публикация черновиков — не промпт: пользователь ничего не писал ИИ, и в диалоге
  // не должно появиться ни сообщения от его имени, ни ответа.
  assert.equal(fixture.chat.opened.length, 0);
  assert.equal(fixture.chat.closed.length, 0);
});

test('AI compact patch result is normalized into a draft and never auto-published', async () => {
  const fixture = createFixture();
  const job = await fixture.service.createJob({
    projectId: PROJECT_ID,
    userId: EDITOR_ID,
    route: '/',
    locator,
    domSnapshot: '<h1>До</h1>',
    computedStyles: {},
    prompt: 'Перепиши заголовок',
    idempotencyKey: 'preview-ai-compact-result',
    operation: 'regenerate_element',
    artifactVersion: ARTIFACT_VERSION,
  });
  await fixture.service.claimJob(PROJECT_ID, DISPATCHER_ID, job.id, ARTIFACT_VERSION);
  await fixture.service.completeJob({
    projectId: PROJECT_ID,
    userId: DISPATCHER_ID,
    jobId: job.id,
    artifactVersion: ARTIFACT_VERSION,
    status: 'succeeded',
    result: { patch: { kind: 'text', value: 'После' } },
  });

  const snapshot = await fixture.service.getPatches(PROJECT_ID, EDITOR_ID, '/');
  assert.equal(snapshot.draftCount, 1);
  assert.equal(snapshot.queuedCount, 0);
  assert.deepEqual(snapshot.patches[0]?.payload, { text: 'После' });
});

async function queueEditJob(fixture: ReturnType<typeof createFixture>, idempotencyKey: string) {
  const job = await fixture.service.createJob({
    projectId: PROJECT_ID,
    userId: EDITOR_ID,
    route: '/catalog',
    locator: { ...locator, textFingerprint: 'Каталог' },
    domSnapshot: '<h1>Каталог</h1>',
    computedStyles: {},
    prompt: 'Сделай заголовок крупнее',
    idempotencyKey,
    operation: 'regenerate_element',
    artifactVersion: ARTIFACT_VERSION,
  });
  await fixture.service.claimJob(PROJECT_ID, DISPATCHER_ID, job.id, ARTIFACT_VERSION);
  return job;
}

test('element edit prompt opens a chat run carrying the zone, not a DOM dump', async () => {
  const fixture = createFixture();
  const job = await queueEditJob(fixture, 'preview-ai-chat-open');

  const [opened] = fixture.chat.opened;
  assert.equal(fixture.chat.opened.length, 1);
  assert.equal(opened?.jobId, job.id);
  assert.equal(opened?.userId, EDITOR_ID);
  assert.equal(opened?.idempotencyKey, 'preview-ai-chat-open');
  assert.equal(opened?.prompt, 'Сделай заголовок крупнее');
  assert.deepEqual(opened?.selection, {
    kind: 'site_element',
    route: '/catalog',
    selector: locator.cssPath,
    tagName: 'h1',
    label: 'Каталог',
    artifactVersion: ARTIFACT_VERSION,
    jobId: job.id,
  });
});

test('a finished job closes its chat run with the words and steps of the AI', async () => {
  const fixture = createFixture();
  const job = await queueEditJob(fixture, 'preview-ai-chat-done');
  const steps = [
    { id: 'step-1', kind: 'write' as const, label: 'Изменение данных', detail: null, startedAt: null, durationMs: 40 },
  ];

  await fixture.service.completeJob({
    projectId: PROJECT_ID,
    userId: DISPATCHER_ID,
    jobId: job.id,
    artifactVersion: ARTIFACT_VERSION,
    status: 'succeeded',
    result: { patch: { kind: 'text', value: 'Каталог товаров' } },
    summary: 'Увеличил кегль заголовка',
    steps,
  });

  const [closed] = fixture.chat.closed;
  assert.equal(fixture.chat.closed.length, 1);
  assert.equal(closed?.jobId, job.id);
  assert.equal(closed?.status, 'succeeded');
  assert.equal(closed?.summary, 'Увеличил кегль заголовка');
  assert.deepEqual(closed?.steps, steps);
});

test('an older worker that reports no summary still closes the chat run', async () => {
  const fixture = createFixture();
  const job = await queueEditJob(fixture, 'preview-ai-chat-legacy');

  await fixture.service.completeJob({
    projectId: PROJECT_ID,
    userId: DISPATCHER_ID,
    jobId: job.id,
    artifactVersion: ARTIFACT_VERSION,
    status: 'succeeded',
  });

  assert.deepEqual(fixture.chat.closed[0], {
    jobId: job.id,
    status: 'succeeded',
    summary: null,
    steps: null,
    error: null,
  });
});

test('the words the worker puts next to the patch reach the chat without a summary field', async () => {
  const fixture = createFixture();
  const job = await queueEditJob(fixture, 'preview-ai-chat-result-message');

  // Ровно то, что шлёт боевой воркер (site-editor-worker.ps1, Invoke-ElementEdit):
  // @{ patch = ...; message = ... } и никакого summary. Без фолбэка на result.message
  // в чат уходила бы фраза-заглушка, хотя ИИ написал, что именно он сделал.
  await fixture.service.completeJob({
    projectId: PROJECT_ID,
    userId: DISPATCHER_ID,
    jobId: job.id,
    artifactVersion: ARTIFACT_VERSION,
    status: 'succeeded',
    result: { patch: { kind: 'text', value: 'Каталог товаров' }, message: 'Увеличил заголовок до 40px' },
  });

  assert.equal(fixture.chat.closed[0]?.summary, 'Увеличил заголовок до 40px');
});

test('a failed job closes the chat run so the answer is not left spinning', async () => {
  const fixture = createFixture();
  const job = await queueEditJob(fixture, 'preview-ai-chat-failed');

  await fixture.service.completeJob({
    projectId: PROJECT_ID,
    userId: DISPATCHER_ID,
    jobId: job.id,
    artifactVersion: ARTIFACT_VERSION,
    status: 'failed',
    error: 'element selector no longer matches',
  });

  const [closed] = fixture.chat.closed;
  assert.equal(closed?.status, 'failed');
  assert.match(closed?.error ?? '', /selector no longer matches/);
});

test('sweeping a dead worker also closes the chat run it abandoned', async () => {
  const fixture = createFixture();
  const job = await queueEditJob(fixture, 'preview-ai-chat-swept');

  fixture.setTime('2026-07-18T10:30:00.000Z');
  assert.equal(await fixture.service.sweepStaleRunningJobs(), 1);

  const [closed] = fixture.chat.closed;
  assert.equal(closed?.jobId, job.id);
  assert.equal(closed?.status, 'failed');
  assert.match(closed?.error ?? '', /did not report back/);
});

test('an unavailable chat never fails the edit it was supposed to mirror', async () => {
  const fixture = createFixture();
  fixture.chat.broken = true;

  const job = await queueEditJob(fixture, 'preview-ai-chat-outage');
  await fixture.service.completeJob({
    projectId: PROJECT_ID,
    userId: DISPATCHER_ID,
    jobId: job.id,
    artifactVersion: ARTIFACT_VERSION,
    status: 'succeeded',
    summary: 'Готово',
  });

  assert.equal(fixture.chat.opened.length, 0);
  assert.equal(fixture.chat.closed.length, 0);
  assert.equal((await fixture.service.getJob(PROJECT_ID, EDITOR_ID, job.id)).status, 'succeeded');
});
