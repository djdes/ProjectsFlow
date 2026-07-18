import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AiConversationService } from '../../application/ai-conversation/AiConversationService.js';
import type { AiConversation } from '../../domain/ai-conversation/AiConversation.js';
import type { AiConversationMessage } from '../../domain/ai-conversation/AiMessage.js';
import type { AiConversationRun } from '../../domain/ai-conversation/AiRun.js';
import type { User } from '../../domain/user/User.js';
import { AiConversationEventHub } from '../../infrastructure/realtime/AiConversationEventHub.js';
import { aiConversationRouter } from './routes.js';

const NOW = new Date('2026-07-19T10:00:00.000Z');
const CONVERSATION_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const REQUEST_ID = '00000000-0000-4000-8000-000000000003';

function buildApp(): express.Express {
  const conversation = conversationFixture();
  const userMessage = messageFixture({ id: 'user-message', seq: 1, role: 'user', status: 'completed', body: 'Hello' });
  const assistantMessage = messageFixture({ id: 'assistant-message', seq: 2, role: 'assistant', status: 'queued', body: '', runId: 'run-1' });
  const run = runFixture();
  const service = {
    async list() { return [conversation]; },
    async sendMessage() {
      return { conversation, userMessage, assistantMessage, run, replayed: false };
    },
  } as unknown as AiConversationService;

  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = {
      id: USER_ID,
      email: 'user@test.dev',
      displayName: 'User',
      avatarUrl: null,
      isAdmin: false,
      createdAt: NOW,
    } as User;
    next();
  });
  app.use('/api/ai', aiConversationRouter({ service, eventHub: new AiConversationEventHub() }));
  return app;
}

async function withServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = http.createServer(buildApp());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address() as AddressInfo;
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('GET conversations uses the stable list response wrapper', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/ai/conversations`);
    assert.equal(response.status, 200);
    const payload = await response.json() as { conversations: Array<Record<string, unknown>> };
    assert.equal(payload.conversations.length, 1);
    assert.equal(payload.conversations[0]?.['id'], CONVERSATION_ID);
    assert.equal(payload.conversations[0]?.['title'], 'Новый чат');
    assert.equal(payload.conversations[0]?.['version'], 1);
  });
});

test('POST message returns conversation, optimistic pair, run and replay marker', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/ai/conversations/${CONVERSATION_ID}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': 'test-request' },
      body: JSON.stringify({ body: 'Hello', clientRequestId: REQUEST_ID }),
    });
    assert.equal(response.status, 202);
    const payload = await response.json() as Record<string, unknown>;
    assert.equal((payload['conversation'] as { id: string }).id, CONVERSATION_ID);
    assert.equal((payload['userMessage'] as { status: string }).status, 'completed');
    assert.equal((payload['assistantMessage'] as { status: string }).status, 'queued');
    assert.equal((payload['run'] as { status: string }).status, 'queued');
    assert.equal(payload['replayed'], false);
  });
});

function conversationFixture(): AiConversation {
  return {
    id: CONVERSATION_ID,
    ownerUserId: USER_ID,
    workspaceId: null,
    projectId: null,
    kind: 'personal',
    title: 'Новый чат',
    version: 1,
    lastMessageSeq: null,
    lastMessageAt: null,
    archivedAt: null,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function messageFixture(patch: Partial<AiConversationMessage>): AiConversationMessage {
  return {
    id: 'message', seq: 1, conversationId: CONVERSATION_ID, role: 'user',
    status: 'completed', body: '', parentMessageId: null, clientRequestId: REQUEST_ID,
    runId: null, model: null, metadata: null, errorCode: null, errorRetryable: false,
    deletedAt: null, createdAt: NOW, updatedAt: NOW, ...patch,
  };
}

function runFixture(): AiConversationRun {
  return {
    id: 'run-1', conversationId: CONVERSATION_ID, projectId: null, dispatcherUserId: USER_ID,
    userMessageId: 'user-message', assistantMessageId: 'assistant-message', mode: 'chat',
    status: 'queued', contextVersion: 1, contextSnapshot: null, idempotencyKey: REQUEST_ID,
    completionIdempotencyKey: null, leaseTokenHash: null, leaseExpiresAt: null, claimedAt: null,
    projectEditJobId: null, model: null, tokensIn: null, tokensOut: null, costUsd: null,
    errorCode: null, errorMessage: null, createdAt: NOW, startedAt: null, finishedAt: null,
    updatedAt: NOW,
  };
}
