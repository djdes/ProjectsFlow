import type { AiPromptJob } from '../../domain/ai-prompt/AiPromptJob.js';
import {
  AiPromptDispatcherNotConfiguredError,
  AiPromptProjectHasNoDispatcherError,
} from '../../domain/ai-prompt/errors.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { InMemoryRateLimiter } from '../../infrastructure/ratelimit/InMemoryRateLimiter.js';
import type { ListKbDocuments } from '../kb/ListKbDocuments.js';
import type { GetKbDocument } from '../kb/GetKbDocument.js';
import type { AiPromptJobRepository } from './AiPromptJobRepository.js';
import { prepareKbContext } from './prepareKbContext.js';

const RATE_LIMIT_PER_HOUR = 60;
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
  readonly text: string;
  readonly projectId: string | null;
};

export class EnqueueAiPromptJob {
  constructor(private readonly deps: Deps) {}

  async execute(input: EnqueueAiPromptJobInput): Promise<AiPromptJob> {
    // Rate-limit (60 запросов/час/userId). Ставим bucket до permission-checks, чтобы
    // подбор валидных projectId'ов не обходил лимит.
    if (!this.deps.rateLimiter.hit(`ai-prompt:${input.userId}`, RATE_LIMIT_PER_HOUR, RATE_LIMIT_WINDOW_MS)) {
      throw new AiPromptRateLimitedError();
    }

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
      if (!project.dispatcherUserId) {
        throw new AiPromptProjectHasNoDispatcherError(input.projectId);
      }
      dispatcherUserId = project.dispatcherUserId;
      // KB-context — best-effort.
      kbContext = await prepareKbContext(project, input.userId, this.deps);
    } else {
      const defaultDispatcher = await this.deps.resolveDefaultDispatcherUserId();
      if (!defaultDispatcher) throw new AiPromptDispatcherNotConfiguredError();
      dispatcherUserId = defaultDispatcher;
    }

    return this.deps.aiPromptJobs.create({
      createdBy: input.userId,
      projectId: input.projectId,
      dispatcherUserId,
      inputText: input.text,
      kbContext,
    });
  }
}
