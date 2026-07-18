import { createHash } from 'node:crypto';
import type { AiConversation, AiConversationKind } from '../../domain/ai-conversation/AiConversation.js';
import { DEFAULT_AI_CONVERSATION_TITLE } from '../../domain/ai-conversation/AiConversation.js';
import type { AiConversationEvent } from '../../domain/ai-conversation/AiConversationEvent.js';
import type { AiConversationMessage } from '../../domain/ai-conversation/AiMessage.js';
import type {
  AiConversationRun,
  AiConversationRunMode,
  PendingAiConversationRun,
} from '../../domain/ai-conversation/AiRun.js';
import {
  AiConversationDispatcherMissingError,
  AiConversationNotFoundError,
  AiConversationRunNotFoundError,
  AiConversationValidationError,
} from '../../domain/ai-conversation/errors.js';
import type { AiConversationEventHub } from '../../infrastructure/realtime/AiConversationEventHub.js';
import { requireProjectAccess, type ProjectAccessDeps } from '../project/projectAccess.js';
import type {
  AiConversationRepository,
  AiMessageRunResult,
  AiRunMutationValue,
  CompleteAiConversationRunInput,
  FailAiConversationRunInput,
} from './AiConversationRepository.js';

const DEFAULT_PAGE = 50;
const MAX_PAGE = 100;

export type AiConversationServiceDeps = {
  readonly repo: AiConversationRepository;
  readonly projectAccess: ProjectAccessDeps;
  readonly eventHub: AiConversationEventHub;
  readonly idGen: () => string;
  readonly now?: () => Date;
  readonly resolvePersonalDispatcher: (userId: string) => Promise<string | null>;
};

export type CreateAiConversationInput = {
  readonly kind: AiConversationKind;
  readonly projectId?: string | null;
  readonly title?: string | null;
};

export type SendAiMessageInput = {
  readonly body: string;
  readonly clientRequestId: string;
  readonly mode?: Extract<AiConversationRunMode, 'chat' | 'studio_plan'>;
  readonly expectedConversationVersion?: number;
  readonly requestId?: string | null;
};

export class AiConversationService {
  private readonly now: () => Date;

  constructor(private readonly deps: AiConversationServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async list(
    userId: string,
    query: {
      kind?: AiConversationKind;
      scope?: 'personal' | 'project' | 'all';
      projectId?: string;
      search?: string;
      archived?: boolean;
      before?: Date;
      limit?: number;
    },
  ): Promise<AiConversation[]> {
    if (query.projectId) {
      await requireProjectAccess(this.deps.projectAccess, query.projectId, userId, 'read_project');
    }
    return this.deps.repo.listForOwner(userId, {
      ...(query.kind
        ? { kind: query.kind }
        : query.scope === 'personal'
          ? { kind: 'personal' as const }
          : query.scope === 'project'
            ? { kind: 'project_studio' as const }
            : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.search?.trim() ? { search: query.search.trim() } : {}),
      ...(query.archived !== undefined ? { archived: query.archived } : {}),
      ...(query.before ? { before: query.before } : {}),
      limit: clampLimit(query.limit),
    });
  }

  async create(userId: string, input: CreateAiConversationInput): Promise<AiConversation> {
    const title = normalizeTitle(input.title ?? DEFAULT_AI_CONVERSATION_TITLE);
    const projectId = input.projectId ?? null;
    if (input.kind === 'project_studio' && !projectId) {
      throw new AiConversationValidationError('projectId is required for a project studio conversation');
    }
    if (input.kind === 'personal' && projectId) {
      throw new AiConversationValidationError('A personal conversation cannot be linked to a project');
    }

    let workspaceId: string | null = null;
    if (projectId) {
      await requireProjectAccess(this.deps.projectAccess, projectId, userId, 'read_project');
      workspaceId = await this.deps.projectAccess.projects.getWorkspaceId(projectId);
    }

    const result = await this.deps.repo.create({
      id: this.deps.idGen(),
      ownerUserId: userId,
      workspaceId,
      projectId,
      kind: input.kind,
      title,
    });
    this.publish(result.events);
    return result.value;
  }

  async get(userId: string, conversationId: string): Promise<AiConversation> {
    return this.loadAuthorized(userId, conversationId);
  }

  async getOrCreateProjectStudio(userId: string, projectId: string): Promise<AiConversation> {
    const access = await requireProjectAccess(
      this.deps.projectAccess,
      projectId,
      userId,
      'read_project',
    );
    const existing = await this.deps.repo.findProjectStudioForOwner(userId, projectId);
    if (existing) return existing;
    return this.create(userId, {
      kind: 'project_studio',
      projectId,
      title: `${access.project.name} — ИИ`,
    });
  }

  async rename(
    userId: string,
    conversationId: string,
    title: string,
    expectedVersion?: number,
  ): Promise<AiConversation> {
    await this.loadAuthorized(userId, conversationId);
    const result = await this.deps.repo.rename(
      conversationId,
      userId,
      normalizeTitle(title),
      expectedVersion,
    );
    if (!result) throw new AiConversationNotFoundError();
    this.publish(result.events);
    return result.value;
  }

  async archive(
    userId: string,
    conversationId: string,
    expectedVersion?: number,
  ): Promise<AiConversation> {
    return this.setArchived(userId, conversationId, true, expectedVersion);
  }

  async restore(
    userId: string,
    conversationId: string,
    expectedVersion?: number,
  ): Promise<AiConversation> {
    return this.setArchived(userId, conversationId, false, expectedVersion);
  }

  async listMessages(
    userId: string,
    conversationId: string,
    query: { beforeSeq?: number; afterSeq?: number; limit?: number },
  ): Promise<AiConversationMessage[]> {
    await this.loadAuthorized(userId, conversationId);
    if (query.beforeSeq !== undefined && query.afterSeq !== undefined) {
      throw new AiConversationValidationError('beforeSeq and afterSeq are mutually exclusive');
    }
    return this.deps.repo.listMessages(conversationId, {
      ...(query.beforeSeq !== undefined ? { beforeSeq: query.beforeSeq } : {}),
      ...(query.afterSeq !== undefined ? { afterSeq: query.afterSeq } : {}),
      limit: clampLimit(query.limit),
    });
  }

  async sendMessage(
    userId: string,
    conversationId: string,
    input: SendAiMessageInput,
  ): Promise<AiMessageRunResult> {
    const conversation = await this.loadAuthorized(userId, conversationId);
    const body = input.body.trim();
    if (!body) throw new AiConversationValidationError('Message body cannot be empty');
    let dispatcherUserId: string | null;
    if (conversation.projectId) {
      const access = await requireProjectAccess(
        this.deps.projectAccess,
        conversation.projectId,
        userId,
        'read_project',
      );
      dispatcherUserId = access.project.dispatcherUserId;
    } else {
      dispatcherUserId = await this.deps.resolvePersonalDispatcher(userId);
    }
    if (!dispatcherUserId) throw new AiConversationDispatcherMissingError();

    const runId = this.deps.idGen();
    const result = await this.deps.repo.createMessageRun({
      conversationId,
      ownerUserId: userId,
      userMessageId: this.deps.idGen(),
      assistantMessageId: this.deps.idGen(),
      runId,
      body,
      clientRequestId: input.clientRequestId,
      dispatcherUserId,
      projectId: conversation.projectId,
      mode: input.mode ?? (conversation.kind === 'project_studio' ? 'studio_plan' : 'chat'),
      contextVersion: 1,
      contextSnapshot: {
        conversationId,
        projectId: conversation.projectId,
        requestedAt: this.now().toISOString(),
      },
      expectedConversationVersion: input.expectedConversationVersion,
      requestId: input.requestId,
    });
    if (!result) throw new AiConversationNotFoundError();
    this.publish(result.events);
    return result.value;
  }

  async cancelRun(
    userId: string,
    conversationId: string,
    runId: string,
    requestId?: string | null,
  ): Promise<AiRunMutationValue> {
    await this.loadAuthorized(userId, conversationId);
    const result = await this.deps.repo.cancelRun(
      conversationId,
      userId,
      runId,
      requestId,
    );
    if (!result) throw new AiConversationRunNotFoundError();
    this.publish(result.events);
    return result.value;
  }

  async listEvents(
    userId: string,
    conversationId: string,
    afterEventSeq: number,
    limit = 100,
  ): Promise<AiConversationEvent[]> {
    await this.loadAuthorized(userId, conversationId);
    return this.deps.repo.listEvents(conversationId, Math.max(0, afterEventSeq), clampLimit(limit));
  }

  async assertCanAccess(userId: string, conversationId: string): Promise<void> {
    await this.loadAuthorized(userId, conversationId);
  }

  async listPendingRuns(dispatcherUserId: string, limit = 20): Promise<PendingAiConversationRun[]> {
    return this.deps.repo.listPendingForDispatcher(dispatcherUserId, clampLimit(limit));
  }

  async claimRun(input: {
    runId: string;
    dispatcherUserId: string;
    leaseToken: string;
    leaseExpiresAt: Date;
  }): Promise<AiConversationRun> {
    const result = await this.deps.repo.claimRun({
      runId: input.runId,
      dispatcherUserId: input.dispatcherUserId,
      leaseTokenHash: hashLease(input.leaseToken),
      leaseExpiresAt: input.leaseExpiresAt,
    });
    if (!result) throw new AiConversationRunNotFoundError();
    this.publish(result.events);
    return result.value;
  }

  async completeRun(input: Omit<CompleteAiConversationRunInput, 'leaseTokenHash'> & {
    leaseToken: string;
  }): Promise<AiRunMutationValue> {
    const { leaseToken, ...completion } = input;
    const result = await this.deps.repo.completeRun({
      ...completion,
      leaseTokenHash: hashLease(leaseToken),
    });
    if (!result) throw new AiConversationRunNotFoundError();
    this.publish(result.events);
    return result.value;
  }

  async failRun(input: Omit<FailAiConversationRunInput, 'leaseTokenHash'> & {
    leaseToken: string;
  }): Promise<AiRunMutationValue> {
    const { leaseToken, ...failure } = input;
    const result = await this.deps.repo.failRun({
      ...failure,
      leaseTokenHash: hashLease(leaseToken),
    });
    if (!result) throw new AiConversationRunNotFoundError();
    this.publish(result.events);
    return result.value;
  }

  private async setArchived(
    userId: string,
    conversationId: string,
    archived: boolean,
    expectedVersion?: number,
  ): Promise<AiConversation> {
    await this.loadAuthorized(userId, conversationId);
    const result = await this.deps.repo.setArchived(
      conversationId,
      userId,
      archived,
      expectedVersion,
    );
    if (!result) throw new AiConversationNotFoundError();
    this.publish(result.events);
    return result.value;
  }

  private async loadAuthorized(userId: string, conversationId: string): Promise<AiConversation> {
    const conversation = await this.deps.repo.findById(conversationId);
    if (!conversation || conversation.deletedAt || conversation.ownerUserId !== userId) {
      throw new AiConversationNotFoundError();
    }
    if (conversation.projectId) {
      await requireProjectAccess(
        this.deps.projectAccess,
        conversation.projectId,
        userId,
        'read_project',
      );
    }
    return conversation;
  }

  private publish(events: readonly AiConversationEvent[]): void {
    for (const event of events) this.deps.eventHub.publish(event.conversationId, event);
  }
}

function normalizeTitle(value: string): string {
  const title = value.trim().replace(/\s+/g, ' ');
  if (!title || title.length > 120) {
    throw new AiConversationValidationError('Conversation title must contain 1 to 120 characters');
  }
  return title;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE);
}

function hashLease(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
