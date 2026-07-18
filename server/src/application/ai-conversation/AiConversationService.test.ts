import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  AiConversationRepository,
  CreateAiMessageRunRecord,
} from './AiConversationRepository.js';
import { AiConversationService } from './AiConversationService.js';
import type { AiConversation } from '../../domain/ai-conversation/AiConversation.js';
import type { AiConversationEvent } from '../../domain/ai-conversation/AiConversationEvent.js';
import type { AiConversationMessage } from '../../domain/ai-conversation/AiMessage.js';
import type { AiConversationRun } from '../../domain/ai-conversation/AiRun.js';
import {
  AiConversationDispatcherMissingError,
  AiConversationNotFoundError,
  AiConversationValidationError,
} from '../../domain/ai-conversation/errors.js';
import { AiConversationEventHub } from '../../infrastructure/realtime/AiConversationEventHub.js';
import type { Project } from '../../domain/project/Project.js';

const NOW = new Date('2026-07-19T10:00:00.000Z');
const USER = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const PROJECT = '00000000-0000-4000-8000-000000000003';
const DISPATCHER = '00000000-0000-4000-8000-000000000004';

class FakeRepo implements AiConversationRepository {
  readonly conversations = new Map<string, AiConversation>();
  lastSend: CreateAiMessageRunRecord | null = null;
  eventSeq = 0;

  async listForOwner(ownerUserId: string) {
    return [...this.conversations.values()].filter((c) => c.ownerUserId === ownerUserId);
  }
  async findById(id: string) { return this.conversations.get(id) ?? null; }
  async findProjectStudioForOwner(ownerUserId: string, projectId: string) {
    return [...this.conversations.values()].find(
      (c) => c.ownerUserId === ownerUserId && c.projectId === projectId && c.kind === 'project_studio',
    ) ?? null;
  }
  async create(input: Parameters<AiConversationRepository['create']>[0]) {
    const value = conversation({ ...input, version: 1 });
    this.conversations.set(value.id, value);
    return { value, events: [this.nextEvent(value.id, 'conversation.created', value.id)] };
  }
  async rename(id: string, ownerUserId: string, title: string) {
    const current = this.conversations.get(id);
    if (!current || current.ownerUserId !== ownerUserId) return null;
    const value = { ...current, title, version: current.version + 1 };
    this.conversations.set(id, value);
    return { value, events: [this.nextEvent(id, 'conversation.updated', id)] };
  }
  async setArchived(id: string, ownerUserId: string, archived: boolean) {
    const current = this.conversations.get(id);
    if (!current || current.ownerUserId !== ownerUserId) return null;
    const value = { ...current, archivedAt: archived ? NOW : null, version: current.version + 1 };
    this.conversations.set(id, value);
    return { value, events: [] };
  }
  async listMessages() { return []; }
  async createMessageRun(input: CreateAiMessageRunRecord) {
    this.lastSend = input;
    const current = this.conversations.get(input.conversationId);
    if (!current || current.ownerUserId !== input.ownerUserId) return null;
    const userMessage = message({
      id: input.userMessageId, seq: 1, conversationId: current.id, role: 'user',
      status: 'completed', body: input.body, clientRequestId: input.clientRequestId,
    });
    const assistantMessage = message({
      id: input.assistantMessageId, seq: 2, conversationId: current.id, role: 'assistant',
      status: 'queued', body: '', runId: input.runId, parentMessageId: input.userMessageId,
    });
    const run = runFixture({
      id: input.runId, conversationId: current.id, projectId: current.projectId,
      dispatcherUserId: input.dispatcherUserId, userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id, mode: input.mode,
      idempotencyKey: input.clientRequestId,
    });
    return {
      value: { conversation: current, userMessage, assistantMessage, run, replayed: false },
      events: [this.nextEvent(current.id, 'run.queued', run.id)],
    };
  }
  async cancelRun() { return null; }
  async listEvents() { return []; }
  async listPendingForDispatcher() { return []; }
  async claimRun() { return null; }
  async completeRun() { return null; }
  async failRun() { return null; }

  private nextEvent(
    conversationId: string,
    eventType: AiConversationEvent['eventType'],
    entityId: string,
  ): AiConversationEvent {
    return { eventSeq: ++this.eventSeq, conversationId, eventType, entityId, payload: null, createdAt: NOW };
  }
}

function build(options: { dispatcher?: string | null; projectMember?: boolean } = {}) {
  const repo = new FakeRepo();
  const eventHub = new AiConversationEventHub();
  let seq = 0;
  const project = projectFixture(options.dispatcher === undefined ? DISPATCHER : options.dispatcher);
  const service = new AiConversationService({
    repo,
    eventHub,
    idGen: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    now: () => NOW,
    resolvePersonalDispatcher: async () => options.dispatcher === undefined ? DISPATCHER : options.dispatcher,
    projectAccess: {
      projects: {
        async getById(id: string) { return id === PROJECT ? project : null; },
        async getWorkspaceId(id: string) { return id === PROJECT ? 'workspace-1' : null; },
      } as never,
      members: {
        async findForProject(projectId: string, userId: string) {
          if (projectId !== PROJECT || userId !== USER || options.projectMember === false) return null;
          return { projectId, userId, role: 'owner' as const, joinedAt: NOW };
        },
      } as never,
    },
  });
  return { repo, eventHub, service };
}

test('project conversation requires a project id and active membership', async () => {
  const { service } = build();
  await assert.rejects(
    () => service.create(USER, { kind: 'project_studio' }),
    AiConversationValidationError,
  );

  const withoutAccess = build({ projectMember: false }).service;
  await assert.rejects(
    () => withoutAccess.create(USER, { kind: 'project_studio', projectId: PROJECT }),
    /Project not found/i,
  );
});

test('conversation IDs do not authorize another owner', async () => {
  const { repo, service } = build();
  repo.conversations.set('conversation-1', conversation({ id: 'conversation-1', ownerUserId: USER }));
  await assert.rejects(() => service.get(OTHER, 'conversation-1'), AiConversationNotFoundError);
});

test('send creates one run through the dedicated dispatcher and publishes durable events', async () => {
  const { repo, service, eventHub } = build();
  repo.conversations.set('conversation-1', conversation({ id: 'conversation-1', ownerUserId: USER }));
  const streamed: AiConversationEvent[] = [];
  eventHub.subscribe('conversation-1', (event) => streamed.push(event));

  const result = await service.sendMessage(USER, 'conversation-1', {
    body: '  Привет, помоги с проектом  ',
    clientRequestId: '00000000-0000-4000-8000-000000000099',
  });

  assert.equal(result.userMessage.body, 'Привет, помоги с проектом');
  assert.equal(result.run.dispatcherUserId, DISPATCHER);
  assert.equal(repo.lastSend?.clientRequestId, '00000000-0000-4000-8000-000000000099');
  assert.equal(repo.lastSend?.mode, 'chat');
  assert.equal(repo.lastSend?.titleFallback, result.userMessage.body);
  assert.equal(streamed[0]?.eventType, 'run.queued');
});

test('send fails before persistence when no dispatcher is configured', async () => {
  const { repo, service } = build({ dispatcher: null });
  repo.conversations.set('conversation-1', conversation({ id: 'conversation-1', ownerUserId: USER }));
  await assert.rejects(
    () => service.sendMessage(USER, 'conversation-1', {
      body: 'test', clientRequestId: '00000000-0000-4000-8000-000000000099',
    }),
    AiConversationDispatcherMissingError,
  );
  assert.equal(repo.lastSend, null);
});

test('project studio get-or-create reuses the owner project conversation', async () => {
  const { repo, service } = build();
  const first = await service.getOrCreateProjectStudio(USER, PROJECT);
  const second = await service.getOrCreateProjectStudio(USER, PROJECT);
  assert.equal(first.id, second.id);
  assert.equal(first.title, 'Проект — ИИ');
  assert.equal(repo.conversations.size, 1);
});

function conversation(patch: Partial<AiConversation> = {}): AiConversation {
  return {
    id: 'conversation-1', ownerUserId: USER, workspaceId: null, projectId: null,
    kind: 'personal', title: 'Новый чат', version: 1, lastMessageSeq: null,
    lastMessageAt: null, archivedAt: null, deletedAt: null, createdAt: NOW, updatedAt: NOW,
    ...patch,
  };
}

function message(patch: Partial<AiConversationMessage>): AiConversationMessage {
  return {
    id: 'message', seq: 1, conversationId: 'conversation-1', role: 'user',
    status: 'completed', body: '', parentMessageId: null, clientRequestId: null,
    runId: null, model: null, metadata: null, errorCode: null, errorRetryable: false,
    deletedAt: null, createdAt: NOW, updatedAt: NOW, ...patch,
  };
}

function runFixture(patch: Partial<AiConversationRun>): AiConversationRun {
  return {
    id: 'run', conversationId: 'conversation-1', projectId: null, dispatcherUserId: DISPATCHER,
    userMessageId: 'user-message', assistantMessageId: 'assistant-message', mode: 'chat',
    status: 'queued', contextVersion: 1, contextSnapshot: null, idempotencyKey: 'request',
    completionIdempotencyKey: null, leaseTokenHash: null, leaseExpiresAt: null, claimedAt: null,
    projectEditJobId: null, model: null, tokensIn: null, tokensOut: null, costUsd: null,
    errorCode: null, errorMessage: null, createdAt: NOW, startedAt: null, finishedAt: null,
    updatedAt: NOW, ...patch,
  };
}

function projectFixture(dispatcherUserId: string | null): Project {
  return {
    id: PROJECT, ownerId: USER, name: 'Проект', icon: null, status: 'active', gitRepoUrl: null,
    kbRepoFullName: null, kbKind: 'none', financeVisibility: 'owner', dispatcherUserId,
    multiTaskWorker: false, isInbox: false, description: null, coverUrl: null, coverPosition: 50,
    publicSlug: null, isPublic: false, publicIndexing: false,
    publicAppearance: { accentColor: '#2383e2', showCover: true, showIcon: true, showDescription: true, showTaskMeta: true },
    appRepoFullName: null, siteSlug: null, createdAt: NOW,
  };
}
