import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';
import type { LlmGateway, LlmGatewayRequest } from '../../application/llm/LlmGateway.js';
import type { GenerateLlmText, GenerateLlmTextInput } from '../../application/llm/LlmTextGenerator.js';
import { RUN_PROMPT_INSTRUCTIONS } from '../../application/llm/promptTemplate.js';
import type { TaskRepository } from '../../application/task/TaskRepository.js';
import { LlmRateLimitedError } from '../../domain/llm/errors.js';
import { llmGatewayRouter } from './gatewayRoutes.js';

const authenticate = {
  async execute() {
    return {
      user: { id: 'dispatcher' },
      token: { id: 'tok-1', scopeKind: 'project', projectId: 'p1', taskId: 't1' },
    };
  },
} as unknown as AuthenticateAgentToken;

const tasks = {
  async getById() {
    return { createdBy: 'creator' };
  },
} as unknown as Pick<TaskRepository, 'getById'>;

async function listen(
  text: GenerateLlmText,
  gateway: Pick<LlmGateway, 'forward'> = { forward: async () => ({ status: 200, headers: {}, body: null }) },
): Promise<{ server: Server; base: string }> {
  const app = express();
  app.use('/api/agent', llmGatewayRouter({ authenticate, gateway: gateway as LlmGateway, text, tasks }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/agent` };
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, {
    method: 'POST',
    headers: { authorization: 'Bearer worker-token', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

test('generate: текст задания уходит в GPT от имени создателя задачи', async () => {
  const calls: GenerateLlmTextInput[] = [];
  const { server, base } = await listen({
    async generate(input) {
      calls.push(input);
      return { text: 'готово', model: 'gpt-6-luna', usage: null, costUsd: 0.001 };
    },
  });
  try {
    const res = await post(`${base}/projects/p1/llm/v1/generate`, { input: 'разбери задачу', tier: 'fast', timeoutSec: 60 });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { text: 'готово', model: 'gpt-6-luna', usage: null, costUsd: 0.001 });
    assert.equal(calls[0]?.billedUserId, 'creator');
    assert.equal(calls[0]?.tier, 'fast');
    assert.equal(calls[0]?.instructions, RUN_PROMPT_INSTRUCTIONS);
    assert.equal(calls[0]?.timeoutMs, 60_000);

    const foreign = await post(`${base}/projects/p2/llm/v1/generate`, { input: 'x' });
    assert.equal(foreign.status, 403);
    const invalid = await post(`${base}/projects/p1/llm/v1/generate`, { tier: 'fast' });
    assert.equal(invalid.status, 400);
  } finally {
    await close(server);
  }
});

test('generate: лимит подписки отдаётся как usage_limit_reached с временем сброса', async () => {
  const resetsAt = new Date('2026-10-06T12:00:00Z');
  const { server, base } = await listen({
    async generate() {
      throw new LlmRateLimitedError(resetsAt);
    },
  });
  try {
    const res = await post(`${base}/projects/p1/llm/v1/generate`, { input: 'x' });
    assert.equal(res.status, 429);
    const body = (await res.json()) as { error: { type: string; resets_at: number } };
    assert.equal(body.error.type, 'usage_limit_reached');
    assert.equal(body.error.resets_at, Math.floor(resetsAt.getTime() / 1000));
  } finally {
    await close(server);
  }
});

test('responses: модель и рабочая папка из заголовков Ralph доходят до шлюза', async () => {
  const forwarded: LlmGatewayRequest[] = [];
  const { server, base } = await listen(
    { generate: async () => ({ text: '', model: '', usage: null, costUsd: null }) },
    {
      async forward(request) {
        forwarded.push(request);
        return { status: 200, headers: { 'content-type': 'text/event-stream' }, body: null };
      },
    },
  );
  try {
    const root = 'C:\\Users\\ralph\\ws\\проект';
    const res = await post(`${base}/projects/p1/llm/v1/responses`, { model: 'gpt-5.5' }, {
      'x-pf-model': 'gpt-6.1-sol',
      'x-pf-workspace-root': encodeURIComponent(root),
    });
    assert.equal(res.status, 200);
    assert.equal(forwarded[0]?.upstreamModel, 'gpt-6.1-sol');
    assert.equal(forwarded[0]?.workspaceRoot, root);
    assert.equal(forwarded[0]?.billedUserId, 'creator');

    await post(`${base}/projects/p1/llm/v1/responses`, { model: 'gpt-5.5' }, { 'x-pf-model': 'bad model;' });
    assert.equal(forwarded[1]?.upstreamModel, null);
    assert.equal(forwarded[1]?.workspaceRoot, null);
  } finally {
    await close(server);
  }
});
