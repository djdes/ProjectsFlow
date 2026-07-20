import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  or,
  sql,
} from 'drizzle-orm';
import type {
  AiConversationRepository,
  AiMessageRunResult,
  AiMutationResult,
  AiRunCompletionPayload,
  AiRunFailurePayload,
  AiRunMutationValue,
  ClaimAiConversationRunInput,
  CompleteAiConversationRunInput,
  CompleteAiRunForEditJobInput,
  CreateAiConversationRecord,
  CreateAiMessageRunRecord,
  FailAiConversationRunInput,
  FailAiRunForEditJobInput,
  ListAiConversationsQuery,
  ListAiMessagesQuery,
} from '../../application/ai-conversation/AiConversationRepository.js';
import type { AiConversation } from '../../domain/ai-conversation/AiConversation.js';
import type {
  AiConversationEvent,
  AiConversationEventType,
} from '../../domain/ai-conversation/AiConversationEvent.js';
import type { AiConversationMessage } from '../../domain/ai-conversation/AiMessage.js';
import type {
  AiConversationRun,
  PendingAiConversationRun,
} from '../../domain/ai-conversation/AiRun.js';
import {
  AiConversationCompletionConflictError,
  AiConversationRunStateConflictError,
  AiConversationVersionConflictError,
} from '../../domain/ai-conversation/errors.js';
import type { Database } from '../db/index.js';
import {
  aiConversationAuditEvents,
  aiConversationEvents,
  aiConversationMessages,
  aiConversationRuns,
  aiConversations,
  projects,
  type AiConversationEventRow,
  type AiConversationMessageRow,
  type AiConversationRow,
  type AiConversationRunRow,
} from '../db/schema.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Tx;

export class DrizzleAiConversationRepository implements AiConversationRepository {
  constructor(private readonly db: Database) {}

  async listForOwner(
    ownerUserId: string,
    query: ListAiConversationsQuery,
  ): Promise<AiConversation[]> {
    const filters = [eq(aiConversations.ownerUserId, ownerUserId), isNull(aiConversations.deletedAt)];
    if (query.kind) filters.push(eq(aiConversations.kind, query.kind));
    if (query.projectId) filters.push(eq(aiConversations.projectId, query.projectId));
    if (query.search) filters.push(like(aiConversations.title, `%${escapeLike(query.search)}%`));
    filters.push(query.archived ? isNotNull(aiConversations.archivedAt) : isNull(aiConversations.archivedAt));
    if (query.before) {
      filters.push(sql`COALESCE(${aiConversations.lastMessageAt}, ${aiConversations.createdAt}) < ${query.before}`);
    }

    const rows = await this.db
      .select()
      .from(aiConversations)
      .where(and(...filters))
      .orderBy(desc(sql`COALESCE(${aiConversations.lastMessageAt}, ${aiConversations.createdAt})`))
      .limit(query.limit);
    return rows.map(toConversation);
  }

  async findById(id: string): Promise<AiConversation | null> {
    const row = await this.findConversationRow(this.db, id);
    return row ? toConversation(row) : null;
  }

  async findProjectStudioForOwner(
    ownerUserId: string,
    projectId: string,
  ): Promise<AiConversation | null> {
    const [row] = await this.db
      .select()
      .from(aiConversations)
      .where(and(
        eq(aiConversations.ownerUserId, ownerUserId),
        eq(aiConversations.projectId, projectId),
        eq(aiConversations.kind, 'project_studio'),
        isNull(aiConversations.archivedAt),
        isNull(aiConversations.deletedAt),
      ))
      .orderBy(desc(aiConversations.updatedAt))
      .limit(1);
    return row ? toConversation(row) : null;
  }

  async create(input: CreateAiConversationRecord): Promise<AiMutationResult<AiConversation>> {
    return this.db.transaction(async (tx) => {
      await tx.insert(aiConversations).values(input);
      const row = await this.findConversationRow(tx, input.id);
      if (!row) throw new Error('AI conversation disappeared after insert');
      const event = await this.insertEvent(tx, {
        conversationId: input.id,
        eventType: 'conversation.created',
        entityId: input.id,
        payload: { version: row.version, kind: row.kind, projectId: row.projectId },
      });
      await this.insertAudit(tx, {
        conversationId: input.id,
        projectId: input.projectId,
        actorKind: 'user',
        actorUserId: input.ownerUserId,
        action: 'conversation.create',
        metadata: { kind: input.kind },
      });
      return { value: toConversation(row), events: [event] };
    });
  }

  async rename(
    id: string,
    ownerUserId: string,
    title: string,
    expectedVersion?: number,
  ): Promise<AiMutationResult<AiConversation> | null> {
    return this.db.transaction(async (tx) => {
      const row = await this.lockOwnedConversation(tx, id, ownerUserId);
      if (!row) return null;
      assertVersion(row, expectedVersion);
      const version = row.version + 1;
      await tx.update(aiConversations).set({ title, version }).where(eq(aiConversations.id, id));
      const updated = await this.findConversationRow(tx, id);
      if (!updated) throw new Error('AI conversation disappeared after rename');
      const event = await this.insertEvent(tx, {
        conversationId: id,
        eventType: 'conversation.updated',
        entityId: id,
        payload: { version, title },
      });
      await this.insertAudit(tx, {
        conversationId: id,
        projectId: row.projectId,
        actorKind: 'user',
        actorUserId: ownerUserId,
        action: 'conversation.rename',
        metadata: { version },
      });
      return { value: toConversation(updated), events: [event] };
    });
  }

  async setArchived(
    id: string,
    ownerUserId: string,
    archived: boolean,
    expectedVersion?: number,
  ): Promise<AiMutationResult<AiConversation> | null> {
    return this.db.transaction(async (tx) => {
      const row = await this.lockOwnedConversation(tx, id, ownerUserId);
      if (!row) return null;
      assertVersion(row, expectedVersion);
      if (Boolean(row.archivedAt) === archived) {
        return { value: toConversation(row), events: [] };
      }
      const version = row.version + 1;
      await tx.update(aiConversations).set({
        archivedAt: archived ? sql`CURRENT_TIMESTAMP(3)` : null,
        version,
      }).where(eq(aiConversations.id, id));
      const updated = await this.findConversationRow(tx, id);
      if (!updated) throw new Error('AI conversation disappeared after archive update');
      const event = await this.insertEvent(tx, {
        conversationId: id,
        eventType: archived ? 'conversation.archived' : 'conversation.restored',
        entityId: id,
        payload: { version },
      });
      await this.insertAudit(tx, {
        conversationId: id,
        projectId: row.projectId,
        actorKind: 'user',
        actorUserId: ownerUserId,
        action: archived ? 'conversation.archive' : 'conversation.restore',
        metadata: { version },
      });
      return { value: toConversation(updated), events: [event] };
    });
  }

  async listMessages(
    conversationId: string,
    query: ListAiMessagesQuery,
  ): Promise<AiConversationMessage[]> {
    const base = eq(aiConversationMessages.conversationId, conversationId);
    if (query.afterSeq !== undefined) {
      const rows = await this.db.select().from(aiConversationMessages)
        .where(and(base, gt(aiConversationMessages.seq, query.afterSeq)))
        .orderBy(asc(aiConversationMessages.seq)).limit(query.limit);
      return rows.map(toMessage);
    }
    const filter = query.beforeSeq === undefined
      ? base
      : and(base, lt(aiConversationMessages.seq, query.beforeSeq));
    const rows = await this.db.select().from(aiConversationMessages)
      .where(filter).orderBy(desc(aiConversationMessages.seq)).limit(query.limit);
    return rows.reverse().map(toMessage);
  }

  async createMessageRun(
    input: CreateAiMessageRunRecord,
  ): Promise<AiMutationResult<AiMessageRunResult> | null> {
    return this.db.transaction(async (tx) => {
      const conversation = await this.lockOwnedConversation(tx, input.conversationId, input.ownerUserId);
      if (!conversation || conversation.archivedAt) return null;

      const [existingUser] = await tx.select().from(aiConversationMessages).where(and(
        eq(aiConversationMessages.conversationId, input.conversationId),
        eq(aiConversationMessages.clientRequestId, input.clientRequestId),
      )).limit(1);
      if (existingUser) {
        const [existingRun] = await tx.select().from(aiConversationRuns)
          .where(eq(aiConversationRuns.userMessageId, existingUser.id)).limit(1);
        if (!existingRun) throw new Error('Idempotent AI message is missing its run');
        const assistant = await this.findMessageRow(tx, existingRun.assistantMessageId);
        if (!assistant) throw new Error('Idempotent AI run is missing its assistant message');
        return {
          value: {
            conversation: toConversation(conversation),
            userMessage: toMessage(existingUser),
            assistantMessage: toMessage(assistant),
            run: toRun(existingRun),
            replayed: true,
          },
          events: [],
        };
      }
      // Idempotent retries must win over a stale optimistic version: the original
      // accepted message is returned even though that send already bumped version.
      assertVersion(conversation, input.expectedConversationVersion);

      await tx.insert(aiConversationMessages).values({
        id: input.userMessageId,
        conversationId: input.conversationId,
        role: 'user',
        status: 'completed',
        body: input.body,
        clientRequestId: input.clientRequestId,
        metadataJson: input.userMessageMetadata ? { ...input.userMessageMetadata } : null,
      });
      await tx.insert(aiConversationMessages).values({
        id: input.assistantMessageId,
        conversationId: input.conversationId,
        role: 'assistant',
        status: 'queued',
        body: '',
        parentMessageId: input.userMessageId,
        runId: input.runId,
      });
      await tx.insert(aiConversationRuns).values({
        id: input.runId,
        conversationId: input.conversationId,
        projectId: input.projectId,
        dispatcherUserId: input.dispatcherUserId,
        userMessageId: input.userMessageId,
        assistantMessageId: input.assistantMessageId,
        mode: input.mode,
        contextVersion: input.contextVersion,
        contextSnapshotJson: input.contextSnapshot ? { ...input.contextSnapshot } : null,
        idempotencyKey: input.clientRequestId,
        projectEditJobId: input.projectEditJobId ?? null,
      });

      const userMessage = await this.findMessageRow(tx, input.userMessageId);
      const assistantMessage = await this.findMessageRow(tx, input.assistantMessageId);
      const run = await this.findRunRow(tx, input.runId);
      if (!userMessage || !assistantMessage || !run) {
        throw new Error('Failed to read atomic AI message/run insert');
      }
      const version = conversation.version + 1;
      await tx.update(aiConversations).set({
        version,
        lastMessageSeq: assistantMessage.seq,
        lastMessageAt: sql`CURRENT_TIMESTAMP(3)`,
        ...(input.titleFallback ? { title: input.titleFallback } : {}),
      }).where(eq(aiConversations.id, input.conversationId));

      const events = await this.insertEvents(tx, [
        event(input.conversationId, 'message.created', userMessage.id, {
          seq: Number(userMessage.seq), role: 'user', status: 'completed',
        }),
        event(input.conversationId, 'message.created', assistantMessage.id, {
          seq: Number(assistantMessage.seq), role: 'assistant', status: 'queued', runId: run.id,
        }),
        event(input.conversationId, 'run.queued', run.id, { status: 'queued' }),
        event(input.conversationId, 'conversation.updated', input.conversationId, {
          version,
          ...(input.titleFallback ? { title: input.titleFallback } : {}),
        }),
      ]);
      await this.insertAudit(tx, {
        conversationId: input.conversationId,
        projectId: input.projectId,
        runId: input.runId,
        messageId: input.userMessageId,
        actorKind: 'user',
        actorUserId: input.ownerUserId,
        action: 'message.send',
        metadata: { mode: input.mode, clientRequestId: input.clientRequestId },
        requestId: input.requestId,
      });

      const updatedConversation = await this.findConversationRow(tx, input.conversationId);
      if (!updatedConversation) throw new Error('AI conversation disappeared after send');
      return {
        value: {
          conversation: toConversation(updatedConversation),
          userMessage: toMessage(userMessage),
          assistantMessage: toMessage(assistantMessage),
          run: toRun(run),
          replayed: false,
        },
        events,
      };
    });
  }

  async cancelRun(
    conversationId: string,
    ownerUserId: string,
    runId: string,
    requestId?: string | null,
  ): Promise<AiMutationResult<AiRunMutationValue> | null> {
    return this.db.transaction(async (tx) => {
      const conversation = await this.lockOwnedConversation(tx, conversationId, ownerUserId);
      if (!conversation) return null;
      const run = await this.lockRun(tx, runId);
      if (!run || run.conversationId !== conversationId) return null;
      if (run.status === 'cancelled') {
        const assistant = await this.findMessageRow(tx, run.assistantMessageId);
        return assistant ? { value: { run: toRun(run), assistantMessage: toMessage(assistant) }, events: [] } : null;
      }
      if (inArrayValue(run.status, ['completed', 'failed'])) {
        throw new AiConversationRunStateConflictError(run.status);
      }
      await tx.update(aiConversationRuns).set({
        status: 'cancelled',
        finishedAt: sql`CURRENT_TIMESTAMP(3)`,
        errorCode: 'CANCELLED_BY_USER',
      }).where(eq(aiConversationRuns.id, runId));
      await tx.update(aiConversationMessages).set({
        status: 'cancelled',
        errorCode: 'CANCELLED_BY_USER',
        errorRetryable: false,
      }).where(eq(aiConversationMessages.id, run.assistantMessageId));
      const updatedRun = await this.findRunRow(tx, runId);
      const assistant = await this.findMessageRow(tx, run.assistantMessageId);
      if (!updatedRun || !assistant) throw new Error('AI run disappeared after cancel');
      const events = await this.insertEvents(tx, [
        event(conversationId, 'message.updated', assistant.id, {
          seq: Number(assistant.seq), status: 'cancelled', runId,
        }),
        event(conversationId, 'run.cancelled', runId, { status: 'cancelled' }),
      ]);
      await this.insertAudit(tx, {
        conversationId,
        projectId: conversation.projectId,
        runId,
        messageId: assistant.id,
        actorKind: 'user',
        actorUserId: ownerUserId,
        action: 'run.cancel',
        metadata: {},
        requestId,
      });
      return { value: { run: toRun(updatedRun), assistantMessage: toMessage(assistant) }, events };
    });
  }

  async listEvents(
    conversationId: string,
    afterEventSeq: number,
    limit: number,
  ): Promise<AiConversationEvent[]> {
    const rows = await this.db.select().from(aiConversationEvents).where(and(
      eq(aiConversationEvents.conversationId, conversationId),
      gt(aiConversationEvents.eventSeq, afterEventSeq),
    )).orderBy(asc(aiConversationEvents.eventSeq)).limit(limit);
    return rows.map(toEvent);
  }

  async listPendingForDispatcher(
    dispatcherUserId: string,
    limit: number,
  ): Promise<PendingAiConversationRun[]> {
    const rows = await this.db.select({
      run: aiConversationRuns,
      conversationTitle: aiConversations.title,
      projectName: projects.name,
      inputText: aiConversationMessages.body,
    }).from(aiConversationRuns)
      .innerJoin(aiConversations, eq(aiConversations.id, aiConversationRuns.conversationId))
      .innerJoin(aiConversationMessages, eq(aiConversationMessages.id, aiConversationRuns.userMessageId))
      .leftJoin(projects, eq(projects.id, aiConversationRuns.projectId))
      .where(and(
        eq(aiConversationRuns.dispatcherUserId, dispatcherUserId),
        // Run, привязанный к job'у визуального редактора, исполняет и закрывает сам job.
        // Отдать его ещё и воркеру чата — значит получить два ответа в одном сообщении
        // и гонку двух завершений.
        isNull(aiConversationRuns.projectEditJobId),
        or(
          eq(aiConversationRuns.status, 'queued'),
          and(
            eq(aiConversationRuns.status, 'running'),
            isNotNull(aiConversationRuns.leaseExpiresAt),
            lt(aiConversationRuns.leaseExpiresAt, sql`CURRENT_TIMESTAMP(3)`),
          ),
        ),
        isNull(aiConversations.deletedAt),
      ))
      .orderBy(asc(aiConversationRuns.createdAt))
      .limit(limit);
    return Promise.all(rows.map(async (row) => ({
      run: toRun(row.run),
      conversationTitle: row.conversationTitle,
      projectName: row.projectName ?? null,
      inputText: row.inputText,
      history: (await this.listMessages(row.run.conversationId, { limit: 40 }))
        .filter((message) => message.status === 'completed' && message.body.trim().length > 0),
    })));
  }

  async claimRun(
    input: ClaimAiConversationRunInput,
  ): Promise<AiMutationResult<AiConversationRun> | null> {
    return this.db.transaction(async (tx) => {
      const run = await this.lockRun(tx, input.runId);
      const expiredLease = run?.status === 'running' && run.leaseExpiresAt !== null &&
        run.leaseExpiresAt.getTime() < Date.now();
      if (!run || run.dispatcherUserId !== input.dispatcherUserId ||
        (run.status !== 'queued' && !expiredLease)) return null;
      await tx.update(aiConversationRuns).set({
        status: 'running',
        leaseTokenHash: input.leaseTokenHash,
        leaseExpiresAt: input.leaseExpiresAt,
        claimedAt: sql`CURRENT_TIMESTAMP(3)`,
        startedAt: sql`CURRENT_TIMESTAMP(3)`,
      }).where(eq(aiConversationRuns.id, input.runId));
      await tx.update(aiConversationMessages).set({ status: 'running' })
        .where(eq(aiConversationMessages.id, run.assistantMessageId));
      const updated = await this.findRunRow(tx, input.runId);
      if (!updated) throw new Error('AI run disappeared after claim');
      const events = await this.insertEvents(tx, [
        event(run.conversationId, 'message.updated', run.assistantMessageId, {
          status: 'running', runId: run.id,
        }),
        event(run.conversationId, 'run.running', run.id, { status: 'running' }),
      ]);
      await this.insertAudit(tx, {
        conversationId: run.conversationId,
        projectId: run.projectId,
        runId: run.id,
        messageId: run.assistantMessageId,
        actorKind: 'dispatcher',
        actorUserId: input.dispatcherUserId,
        action: expiredLease ? 'run.reclaim' : 'run.claim',
        metadata: { leaseExpiresAt: input.leaseExpiresAt.toISOString() },
      });
      return { value: toRun(updated), events };
    });
  }

  async completeRun(
    input: CompleteAiConversationRunInput,
  ): Promise<AiMutationResult<AiRunMutationValue> | null> {
    const { runId, dispatcherUserId, leaseTokenHash, ...payload } = input;
    return this.finishRun(payload, 'completed', { kind: 'lease', runId, dispatcherUserId, leaseTokenHash });
  }

  async failRun(
    input: FailAiConversationRunInput,
  ): Promise<AiMutationResult<AiRunMutationValue> | null> {
    const { runId, dispatcherUserId, leaseTokenHash, ...payload } = input;
    return this.finishRun(payload, 'failed', { kind: 'lease', runId, dispatcherUserId, leaseTokenHash });
  }

  async completeRunForEditJob(
    input: CompleteAiRunForEditJobInput,
  ): Promise<AiMutationResult<AiRunMutationValue> | null> {
    const { projectEditJobId, ...payload } = input;
    return this.finishRun(payload, 'completed', { kind: 'edit_job', projectEditJobId });
  }

  async failRunForEditJob(
    input: FailAiRunForEditJobInput,
  ): Promise<AiMutationResult<AiRunMutationValue> | null> {
    const { projectEditJobId, ...payload } = input;
    return this.finishRun(payload, 'failed', { kind: 'edit_job', projectEditJobId });
  }

  private async finishRun(
    input: AiRunCompletionPayload | AiRunFailurePayload,
    terminalStatus: 'completed' | 'failed',
    auth: FinishRunAuth,
  ): Promise<AiMutationResult<AiRunMutationValue> | null> {
    return this.db.transaction(async (tx) => {
      const completeInput = terminalStatus === 'completed'
        ? input as AiRunCompletionPayload
        : null;
      const failInput = terminalStatus === 'failed'
        ? input as AiRunFailurePayload
        : null;
      const run = auth.kind === 'lease'
        ? await this.lockRun(tx, auth.runId)
        : await this.lockRunByEditJob(tx, auth.projectEditJobId);
      if (!run) return null;
      // Сверка диспетчера — часть lease-пути. Внутренний путь находит run по
      // project_edit_job_id, а доступ к самому job'у уже проверил site-editor.
      if (auth.kind === 'lease' && run.dispatcherUserId !== auth.dispatcherUserId) return null;
      if (run.status === terminalStatus) {
        if (run.completionIdempotencyKey !== input.completionIdempotencyKey) {
          throw new AiConversationCompletionConflictError();
        }
        const assistant = await this.findMessageRow(tx, run.assistantMessageId);
        return assistant ? { value: { run: toRun(run), assistantMessage: toMessage(assistant) }, events: [] } : null;
      }
      if (auth.kind === 'lease') {
        if (run.status !== 'running' || run.leaseTokenHash !== auth.leaseTokenHash ||
          !run.leaseExpiresAt || run.leaseExpiresAt.getTime() < Date.now()) {
          throw new AiConversationRunStateConflictError(run.status);
        }
      } else if (inArrayValue(run.status, ['completed', 'failed', 'cancelled'])) {
        // Пользователь отменил правку, либо run уже закрыт другим путём (например,
        // подметанием зависших job'ов). Воскрешать закрытое сообщение нельзя.
        const assistant = await this.findMessageRow(tx, run.assistantMessageId);
        return assistant ? { value: { run: toRun(run), assistantMessage: toMessage(assistant) }, events: [] } : null;
      }

      const completed = completeInput !== null;
      await tx.update(aiConversationRuns).set(completeInput ? {
        status: 'completed',
        completionIdempotencyKey: completeInput.completionIdempotencyKey,
        model: completeInput.model,
        tokensIn: completeInput.tokensIn,
        tokensOut: completeInput.tokensOut,
        costUsd: completeInput.costUsd == null ? null : String(completeInput.costUsd),
        finishedAt: sql`CURRENT_TIMESTAMP(3)`,
        errorCode: null,
        errorMessage: null,
      } : {
        status: 'failed',
        completionIdempotencyKey: failInput!.completionIdempotencyKey,
        finishedAt: sql`CURRENT_TIMESTAMP(3)`,
        errorCode: failInput!.errorCode,
        errorMessage: failInput!.errorMessage,
      }).where(eq(aiConversationRuns.id, run.id));

      const priorMetadata = completeInput
        ? (await this.findMessageRow(tx, run.assistantMessageId))?.metadataJson ?? null
        : null;

      await tx.update(aiConversationMessages).set(completeInput ? {
        status: 'completed',
        body: completeInput.body,
        model: completeInput.model,
        metadataJson: mergeMessageMetadata(priorMetadata, completeInput),
        errorCode: null,
        errorRetryable: false,
      } : {
        status: 'failed',
        errorCode: failInput!.errorCode,
        errorRetryable: failInput!.retryable,
      }).where(eq(aiConversationMessages.id, run.assistantMessageId));

      const assistant = await this.findMessageRow(tx, run.assistantMessageId);
      const updatedRun = await this.findRunRow(tx, run.id);
      if (!assistant || !updatedRun) throw new Error('AI run disappeared during completion');
      await tx.update(aiConversations).set({
        lastMessageSeq: assistant.seq,
        lastMessageAt: sql`CURRENT_TIMESTAMP(3)`,
        version: sql`${aiConversations.version} + 1`,
      }).where(eq(aiConversations.id, run.conversationId));

      const events = await this.insertEvents(tx, [
        event(run.conversationId, 'message.updated', assistant.id, {
          seq: Number(assistant.seq), status: terminalStatus, runId: run.id,
        }),
        event(
          run.conversationId,
          completed ? 'run.completed' : 'run.failed',
          run.id,
          { status: terminalStatus },
        ),
        event(run.conversationId, 'conversation.updated', run.conversationId, {
          lastMessageSeq: Number(assistant.seq),
        }),
      ]);
      await this.insertAudit(tx, {
        conversationId: run.conversationId,
        projectId: run.projectId,
        runId: run.id,
        messageId: assistant.id,
        // Внутренний путь пишется как 'system': ответ в чат положил сервер по факту
        // завершения job'а, а не диспетчер своим вызовом /complete.
        ...(auth.kind === 'lease'
          ? { actorKind: 'dispatcher' as const, actorUserId: auth.dispatcherUserId }
          : { actorKind: 'system' as const, actorUserId: null }),
        action: completed ? 'run.complete' : 'run.fail',
        metadata: completeInput
          ? {
              model: completeInput.model,
              tokensIn: completeInput.tokensIn,
              tokensOut: completeInput.tokensOut,
              ...(auth.kind === 'edit_job' ? { projectEditJobId: auth.projectEditJobId } : {}),
            }
          : {
              errorCode: failInput!.errorCode,
              retryable: failInput!.retryable,
              ...(auth.kind === 'edit_job' ? { projectEditJobId: auth.projectEditJobId } : {}),
            },
        requestId: input.requestId,
      });
      return { value: { run: toRun(updatedRun), assistantMessage: toMessage(assistant) }, events };
    });
  }

  private async lockOwnedConversation(
    tx: Tx,
    id: string,
    ownerUserId: string,
  ): Promise<AiConversationRow | undefined> {
    const [row] = await tx.select().from(aiConversations).where(and(
      eq(aiConversations.id, id),
      eq(aiConversations.ownerUserId, ownerUserId),
      isNull(aiConversations.deletedAt),
    )).limit(1).for('update');
    return row;
  }

  private async lockRun(tx: Tx, runId: string): Promise<AiConversationRunRow | undefined> {
    const [row] = await tx.select().from(aiConversationRuns)
      .where(eq(aiConversationRuns.id, runId)).limit(1).for('update');
    return row;
  }

  private async lockRunByEditJob(
    tx: Tx,
    projectEditJobId: string,
  ): Promise<AiConversationRunRow | undefined> {
    // Сначала обычное чтение, и только потом блокировка по первичному ключу.
    // project_edit_job_id не проиндексирован, а `SELECT ... FOR UPDATE` по
    // непроиндексированной колонке берёт в InnoDB gap-локи на весь просмотренный
    // диапазон — то есть подвесил бы вставку новых сообщений во все диалоги разом.
    const [found] = await tx.select({ id: aiConversationRuns.id }).from(aiConversationRuns)
      .where(eq(aiConversationRuns.projectEditJobId, projectEditJobId)).limit(1);
    return found ? this.lockRun(tx, found.id) : undefined;
  }

  private async findConversationRow(executor: Executor, id: string): Promise<AiConversationRow | undefined> {
    const [row] = await executor.select().from(aiConversations)
      .where(eq(aiConversations.id, id)).limit(1);
    return row;
  }

  private async findMessageRow(
    executor: Executor,
    id: string,
  ): Promise<AiConversationMessageRow | undefined> {
    const [row] = await executor.select().from(aiConversationMessages)
      .where(eq(aiConversationMessages.id, id)).limit(1);
    return row;
  }

  private async findRunRow(executor: Executor, id: string): Promise<AiConversationRunRow | undefined> {
    const [row] = await executor.select().from(aiConversationRuns)
      .where(eq(aiConversationRuns.id, id)).limit(1);
    return row;
  }

  private async insertEvents(
    tx: Tx,
    events: readonly NewEvent[],
  ): Promise<AiConversationEvent[]> {
    const persisted: AiConversationEvent[] = [];
    for (const item of events) persisted.push(await this.insertEvent(tx, item));
    return persisted;
  }

  private async insertEvent(tx: Tx, input: NewEvent): Promise<AiConversationEvent> {
    const result = await tx.insert(aiConversationEvents).values({
      conversationId: input.conversationId,
      eventType: input.eventType,
      entityId: input.entityId,
      payloadJson: input.payload ? { ...input.payload } : null,
    });
    const eventSeq = Number(result[0].insertId);
    const [row] = await tx.select().from(aiConversationEvents)
      .where(eq(aiConversationEvents.eventSeq, eventSeq)).limit(1);
    if (!row) throw new Error('AI conversation event disappeared after insert');
    return toEvent(row);
  }

  private async insertAudit(tx: Tx, input: NewAudit): Promise<void> {
    await tx.insert(aiConversationAuditEvents).values({
      conversationId: input.conversationId,
      projectId: input.projectId ?? null,
      runId: input.runId ?? null,
      messageId: input.messageId ?? null,
      actorKind: input.actorKind,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      metadataJson: input.metadata ? { ...input.metadata } : null,
      requestId: input.requestId ?? null,
    });
  }
}

// Как авторизовано завершение run'а: lease-токеном воркера чата либо связью с job'ом
// визуального редактора, который run и породил.
type FinishRunAuth =
  | {
      readonly kind: 'lease';
      readonly runId: string;
      readonly dispatcherUserId: string;
      readonly leaseTokenHash: string;
    }
  | { readonly kind: 'edit_job'; readonly projectEditJobId: string };

type NewEvent = {
  readonly conversationId: string;
  readonly eventType: AiConversationEventType;
  readonly entityId: string | null;
  readonly payload: Readonly<Record<string, unknown>> | null;
};

type NewAudit = {
  readonly conversationId: string;
  readonly projectId?: string | null;
  readonly runId?: string | null;
  readonly messageId?: string | null;
  readonly actorKind: 'user' | 'dispatcher' | 'system';
  readonly actorUserId?: string | null;
  readonly action: string;
  readonly metadata: Readonly<Record<string, unknown>> | null;
  readonly requestId?: string | null;
};

function event(
  conversationId: string,
  eventType: AiConversationEventType,
  entityId: string | null,
  payload: Readonly<Record<string, unknown>> | null,
): NewEvent {
  return { conversationId, eventType, entityId, payload };
}

function toConversation(row: AiConversationRow): AiConversation {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    workspaceId: row.workspaceId ?? null,
    projectId: row.projectId ?? null,
    kind: row.kind,
    title: row.title,
    version: row.version,
    lastMessageSeq: row.lastMessageSeq == null ? null : Number(row.lastMessageSeq),
    lastMessageAt: row.lastMessageAt ?? null,
    archivedAt: row.archivedAt ?? null,
    deletedAt: row.deletedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMessage(row: AiConversationMessageRow): AiConversationMessage {
  return {
    id: row.id,
    seq: Number(row.seq),
    conversationId: row.conversationId,
    role: row.role,
    status: row.status,
    body: row.body,
    parentMessageId: row.parentMessageId ?? null,
    clientRequestId: row.clientRequestId ?? null,
    runId: row.runId ?? null,
    model: row.model ?? null,
    metadata: row.metadataJson ?? null,
    errorCode: row.errorCode ?? null,
    errorRetryable: row.errorRetryable,
    deletedAt: row.deletedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRun(row: AiConversationRunRow): AiConversationRun {
  return {
    id: row.id,
    conversationId: row.conversationId,
    projectId: row.projectId ?? null,
    dispatcherUserId: row.dispatcherUserId,
    userMessageId: row.userMessageId,
    assistantMessageId: row.assistantMessageId,
    mode: row.mode,
    status: row.status,
    contextVersion: row.contextVersion,
    contextSnapshot: row.contextSnapshotJson ?? null,
    idempotencyKey: row.idempotencyKey,
    completionIdempotencyKey: row.completionIdempotencyKey ?? null,
    leaseTokenHash: row.leaseTokenHash ?? null,
    leaseExpiresAt: row.leaseExpiresAt ?? null,
    claimedAt: row.claimedAt ?? null,
    projectEditJobId: row.projectEditJobId ?? null,
    model: row.model ?? null,
    tokensIn: row.tokensIn == null ? null : Number(row.tokensIn),
    tokensOut: row.tokensOut == null ? null : Number(row.tokensOut),
    costUsd: row.costUsd == null ? null : Number(row.costUsd),
    errorCode: row.errorCode ?? null,
    errorMessage: row.errorMessage ?? null,
    createdAt: row.createdAt,
    startedAt: row.startedAt ?? null,
    finishedAt: row.finishedAt ?? null,
    updatedAt: row.updatedAt,
  };
}

function toEvent(row: AiConversationEventRow): AiConversationEvent {
  return {
    eventSeq: Number(row.eventSeq),
    conversationId: row.conversationId,
    eventType: row.eventType as AiConversationEventType,
    entityId: row.entityId ?? null,
    payload: row.payloadJson ?? null,
    createdAt: row.createdAt,
  };
}

/**
 * Дописать шаги/источники/подсказки в metadata ассистентского сообщения, не трогая
 * остальное. Отсутствующее поле (воркер старой версии) не должно стирать уже
 * записанное — иначе ретрай завершения обнулял бы ленту шагов.
 */
function mergeMessageMetadata(
  current: Record<string, unknown> | null,
  input: AiRunCompletionPayload,
): Record<string, unknown> | null {
  if (input.steps == null && input.knowledge == null && input.suggestions == null) return current;
  return {
    ...(current ?? {}),
    ...(input.steps == null ? {} : { steps: input.steps }),
    ...(input.knowledge == null ? {} : { knowledge: input.knowledge }),
    ...(input.suggestions == null ? {} : { suggestions: input.suggestions }),
  };
}

function assertVersion(row: AiConversationRow, expectedVersion: number | undefined): void {
  if (expectedVersion !== undefined && row.version !== expectedVersion) {
    throw new AiConversationVersionConflictError(row.version);
  }
}

function inArrayValue<T extends string>(value: T, values: readonly T[]): boolean {
  return values.includes(value);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
