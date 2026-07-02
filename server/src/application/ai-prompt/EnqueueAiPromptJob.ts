import type { AiPromptJob, AiPromptJobMode } from '../../domain/ai-prompt/AiPromptJob.js';
import {
  AiPromptDispatcherNotConfiguredError,
  AiPromptProjectHasNoDispatcherError,
} from '../../domain/ai-prompt/errors.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { InMemoryRateLimiter } from '../../infrastructure/ratelimit/InMemoryRateLimiter.js';
import type { ListProjects } from '../project/ListProjects.js';
import type { ListKbDocuments } from '../kb/ListKbDocuments.js';
import type { GetKbDocument } from '../kb/GetKbDocument.js';
import type { AiPromptJobRepository } from './AiPromptJobRepository.js';
import { prepareKbContext } from './prepareKbContext.js';
import { prepareComposeContext } from './prepareComposeContext.js';

const RATE_LIMIT_PER_HOUR = 60;
// compose тяжелее (2 прохода opus + KB многих проектов) — отдельный, более строгий лимит.
const RATE_LIMIT_COMPOSE_PER_HOUR = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export class AiPromptRateLimitedError extends Error {
  constructor() {
    super('Превышен лимит AI-запросов (60 в час). Попробуй позже.');
    this.name = 'AiPromptRateLimitedError';
  }
}

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly aiPromptJobs: AiPromptJobRepository;
  readonly listProjects: ListProjects;
  readonly listKbDocuments: ListKbDocuments;
  readonly getKbDocument: GetKbDocument;
  readonly rateLimiter: InMemoryRateLimiter;
  /**
   * Резолвер дефолтного диспетчера для Inbox-задач (без projectId).
   * Возвращает userId или null если не сконфигурирован
   * (env AI_PROMPT_DEFAULT_DISPATCHER_EMAIL не задан или юзера нет).
   */
  readonly resolveDefaultDispatcherUserId: () => Promise<string | null>;
};

export type EnqueueAiPromptJobInput = {
  readonly userId: string;
  // Для 'compose-advanced' — это JSON-строка сегментов из pass-1, а не свободный текст.
  readonly text: string;
  readonly projectId: string | null;
  // 'improve' (legacy, default) | 'compose' (pass-1) | 'compose-advanced' (ленивый pass-2).
  readonly mode?: AiPromptJobMode;
};

export class EnqueueAiPromptJob {
  constructor(private readonly deps: Deps) {}

  async execute(input: EnqueueAiPromptJobInput): Promise<AiPromptJob> {
    const mode: AiPromptJobMode = input.mode ?? 'improve';
    // pass-1 и ленивый pass-2 — оба opus-тяжёлые и кросс-проектные: общий лимит и общая
    // логика резолва диспетчера. advanced отличается лишь тем, что НЕ собирает контекст
    // кандидатов (полную KB воркер берёт сам по projectId'ам из сегментов через /kb-bundle).
    const isComposeLike = mode === 'compose' || mode === 'compose-advanced';

    // Rate-limit (per userId). Ставим bucket до permission-checks, чтобы подбор валидных
    // projectId'ов не обходил лимит. compose — отдельный, более строгий bucket.
    const bucket = isComposeLike ? `ai-compose:${input.userId}` : `ai-prompt:${input.userId}`;
    const perHour = isComposeLike ? RATE_LIMIT_COMPOSE_PER_HOUR : RATE_LIMIT_PER_HOUR;
    if (!this.deps.rateLimiter.hit(bucket, perHour, RATE_LIMIT_WINDOW_MS)) {
      throw new AiPromptRateLimitedError();
    }

    // AI-переработка/compose доступна ВСЕМ тарифам бесплатно и без списания лимитов
    // (сознательное решение): гейта плана/бюджета тут нет. От злоупотребления защищает
    // rate-limit выше (improve 60/час, compose 30/час на пользователя).

    let dispatcherUserId: string;
    let kbContext: string | null = null;

    if (input.projectId !== null) {
      // Permission на проект + резолв dispatcher'а проекта.
      const { project } = await requireProjectAccess(
        this.deps,
        input.projectId,
        input.userId,
        'read_project',
      );
      if (project.dispatcherUserId) {
        dispatcherUserId = project.dispatcherUserId;
      } else if (isComposeLike) {
        // compose кросс-проектный: если у текущего проекта нет диспетчера — отдаём
        // дефолтному (он лишь гоняет Claude, не обязан быть диспетчером всех кандидатов).
        const fallback = await this.deps.resolveDefaultDispatcherUserId();
        if (!fallback) throw new AiPromptProjectHasNoDispatcherError(input.projectId);
        dispatcherUserId = fallback;
      } else {
        throw new AiPromptProjectHasNoDispatcherError(input.projectId);
      }
      // improve: KB одного (текущего) проекта. compose: KB-контекст собирается ниже
      // из ВСЕХ проектов-кандидатов, поэтому одиночный KB здесь не нужен.
      if (mode === 'improve') {
        kbContext = await prepareKbContext(project, input.userId, this.deps);
      }
    } else {
      const defaultDispatcher = await this.deps.resolveDefaultDispatcherUserId();
      if (!defaultDispatcher) throw new AiPromptDispatcherNotConfiguredError();
      dispatcherUserId = defaultDispatcher;
    }

    if (mode === 'compose') {
      // Дайджесты всех проектов-кандидатов пользователя (для разбивки + классификации).
      // Best-effort: если KB/проектов нет — compose всё равно отработает (без заземления).
      const ctx = await prepareComposeContext(input.userId, this.deps);
      kbContext = ctx?.block ?? null;
    }

    return this.deps.aiPromptJobs.create({
      createdBy: input.userId,
      projectId: input.projectId,
      dispatcherUserId,
      mode,
      inputText: input.text,
      kbContext,
    });
  }
}
