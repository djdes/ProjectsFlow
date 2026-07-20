import { createHash, randomBytes } from 'node:crypto';
import type { ProjectAccessDeps } from '../project/projectAccess.js';
import { requireDispatcherAccess, requireProjectAccess } from '../project/projectAccess.js';
import type { SiteArtifactRepository } from '../site/SiteArtifactRepository.js';
import type { AiAgentStep } from '../../domain/ai-conversation/AiAgentStep.js';
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
import type { EditRunChatSink } from './EditRunChatSink.js';
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
  /**
   * Зеркалирование правок в чат проекта. Опционально: без сконфигурированного чата
   * редактор обязан работать ровно как раньше (и так собран каждый его тест).
   */
  readonly chat?: EditRunChatSink;
};

const SESSION_TTL_MS = 15 * 60 * 1000;

// Максимум совпадает с полем `summary` в completeJobSchema: слова ИИ уходят в тело
// сообщения чата, откуда бы они ни приехали.
const MAX_CHAT_SUMMARY = 10_000;

/**
 * Слова ИИ, приехавшие в результате job'а. Отдельного `summary` боевой воркер
 * визуального редактора не шлёт, но ответ модели у него есть — он кладёт его в
 * `result.message` рядом с патчем. Без этого фолбэка в чат на КАЖДУЮ правку уходила бы
 * одна и та же фраза-заглушка, хотя ИИ написал, что именно он сделал.
 */
function summaryFromJobResult(result: ProjectEditJob['result']): string | null {
  const message = result?.['message'];
  if (typeof message !== 'string') return null;
  return message.trim().slice(0, MAX_CHAT_SUMMARY) || null;
}

function normalizeJobResultPatch(candidate: unknown): { kind: SitePatchKind; payload: Readonly<Record<string, unknown>> } | null {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const patch = candidate as Record<string, unknown>;
  const kind = patch['kind'];
  if (!['text', 'html', 'style', 'attribute', 'visibility', 'command'].includes(String(kind))) {
    throw new SiteEditorValidationError('Invalid result patch kind');
  }
  if (patch['payload'] && typeof patch['payload'] === 'object' && !Array.isArray(patch['payload'])) {
    return { kind: kind as SitePatchKind, payload: patch['payload'] as Record<string, unknown> };
  }
  if (kind === 'text' && typeof patch['value'] === 'string') return { kind, payload: { text: patch['value'] } };
  if (kind === 'html' && typeof patch['value'] === 'string') return { kind, payload: { html: patch['value'] } };
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
    const job = await this.deps.repository.createJob({
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
    await this.openChatRun(job, input.userId);
    return job;
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

  // Глобальная очередь для раннера: отдаём все queued-job'ы, назначенные этому диспетчеру,
  // сразу по всем проектам. Авторизация — сам фильтр по dispatcherUserId: чужие job'ы в
  // выборку не попадают, поэтому отдельная проверка доступа к проекту здесь не нужна
  // (тот же приём, что в ListPendingAiPromptJobs).
  async listQueuedJobsForDispatcher(userId: string, limit = 20): Promise<readonly ProjectEditJob[]> {
    return this.deps.repository.listQueuedJobsForDispatcher(userId, Math.max(1, Math.min(50, limit)));
  }

  // Подметает job'ы, зависшие в running. Воркер диспетчера может умереть в любой момент
  // (упавший процесс, перезагрузка машины, необработанное исключение) — и тогда job остаётся
  // running навсегда: никакого TTL у него нет, а пользователь всё это время смотрит на
  // «Сохраняем правки в проект…», которое никогда не закончится. Помечаем такие job'ы
  // failed, что возвращает их патчи в draft — работа пользователя не теряется, он просто
  // может опубликовать её заново. Зеркало liveService.sweepStaleRunning().
  async sweepStaleRunningJobs(olderThanMinutes = 20, limit = 100): Promise<number> {
    const cutoff = new Date(this.now().getTime() - olderThanMinutes * 60_000);
    const stale = await this.deps.repository.listStaleRunningJobs(cutoff, limit);
    let swept = 0;
    for (const job of stale) {
      const done = await this.deps.repository.completeJob({
        projectId: job.projectId,
        jobId: job.id,
        dispatcherUserId: job.dispatcherUserId,
        status: 'failed',
        result: null,
        error: `worker did not report back within ${olderThanMinutes} min — правки возвращены в черновик`,
        finishedAt: this.now(),
      });
      if (!done) continue;
      swept += 1;
      // Подметание идёт мимо completeJob, поэтому сообщение в чате закрываем здесь же:
      // иначе у пользователя навсегда осталась бы «печатает…» на мёртвой правке.
      await this.closeChatRun(done, null, null);
    }
    return swept;
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
    // Слова ИИ для чата проекта. Воркер старой версии их не шлёт — тогда в диалог
    // уходит фолбэк, а сообщение всё равно закрывается.
    summary?: string | null;
    steps?: readonly AiAgentStep[] | null;
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
    // Публикация черновиков приходит не из чата (её ставит кнопка Edit, а не промпт),
    // поэтому и закрывать там нечего: искать несуществующий run на каждой публикации —
    // лишний проход по таблице сообщений.
    if (!isDraftPublish) await this.closeChatRun(completed, input.summary, input.steps);
    return completed;
  }

  async getArtifactVersionForDispatcher(projectId: string, userId: string): Promise<string | null> {
    await requireDispatcherAccess(this.deps, projectId, userId);
    return this.currentArtifactVersion(projectId);
  }

  /**
   * Промпт правки обязан лечь в чат проекта: пользователь пишет ИИ, а не «в job».
   *
   * Best-effort по построению. Job на этот момент уже сохранён и будет выполнен, так
   * что упавшая запись в чат не должна превращаться в ошибку правки — иначе UI скажет
   * «не удалось» там, где изменение всё равно применится.
   */
  private async openChatRun(job: ProjectEditJob, userId: string): Promise<void> {
    if (!this.deps.chat) return;
    try {
      await this.deps.chat.openEditRun({
        projectId: job.projectId,
        userId,
        jobId: job.id,
        idempotencyKey: job.idempotencyKey,
        prompt: job.prompt,
        selection: {
          kind: 'site_element',
          route: job.route,
          selector: job.locator.cssPath,
          tagName: job.locator.tagName,
          // Текстовый отпечаток уже прошёл redact в sanitizeLocator.
          label: job.locator.textFingerprint ?? null,
          artifactVersion: job.artifactVersion,
          jobId: job.id,
        },
      });
    } catch (error) {
      console.warn('[site-editor] edit prompt did not reach the project chat:', error);
    }
  }

  private async closeChatRun(
    job: ProjectEditJob,
    summary: string | null | undefined,
    steps: readonly AiAgentStep[] | null | undefined,
  ): Promise<void> {
    if (!this.deps.chat) return;
    try {
      await this.deps.chat.closeEditRun({
        jobId: job.id,
        status: job.status === 'succeeded' ? 'succeeded' : 'failed',
        // Явный `summary` воркера — приоритетнее; иначе берём слова модели из результата.
        summary: summary?.trim() || summaryFromJobResult(job.result),
        steps: steps ?? null,
        error: job.error,
      });
    } catch (error) {
      console.warn('[site-editor] edit result did not reach the project chat:', error);
    }
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
