import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';
import { AiPromptRateLimitedError, type EnqueueAiPromptJobInput } from '../../application/ai-prompt/EnqueueAiPromptJob.js';
import type { WaitForAiPromptJobInput } from '../../application/ai-prompt/WaitForAiPromptJob.js';
import type { AiPromptJob } from '../../domain/ai-prompt/AiPromptJob.js';
import { AiPromptJobAccessDeniedError } from '../../domain/ai-prompt/errors.js';
import type { User } from '../../domain/user/User.js';
import { aiTextJobsRouter } from './routes.js';

const USER_ID = '00000000-0000-4000-8000-000000000002';
const JOB_ID = '00000000-0000-4000-8000-0000000000aa';
const NOW = new Date('2026-11-05T10:00:00.000Z');

function job(overrides: Partial<AiPromptJob> = {}): AiPromptJob {
  return {
    id: JOB_ID,
    createdBy: USER_ID,
    projectId: null,
    dispatcherUserId: 'disp-1',
    status: 'queued',
    mode: 'text',
    inputText: '{}',
    kbContext: null,
    improvedText: null,
    error: null,
    claimedAt: null,
    finishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

type Harness = {
  enqueued: EnqueueAiPromptJobInput[];
  waited: WaitForAiPromptJobInput[];
  enqueueError?: Error;
  waitResult: AiPromptJob | null;
  waitError?: Error;
};

function buildApp(h: Harness): express.Express {
  const authenticate = {
    async execute(token: string) {
      return {
        user: { id: USER_ID } as User,
        token: { id: 'token-1', scopeKind: token === 'account-token' ? 'account' : 'project' },
      };
    },
  } as unknown as AuthenticateAgentToken;
  const app = express();
  app.use(express.json());
  // «Сессия»: пользователь есть, если нет Bearer и не попросили анонима.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (!req.headers.authorization && !req.headers['x-anonymous']) {
      req.user = { id: USER_ID } as User;
    }
    next();
  });
  app.use('/api/ai/text-jobs', aiTextJobsRouter({
    enqueueAiPromptJob: {
      async execute(input) {
        h.enqueued.push(input);
        if (h.enqueueError) throw h.enqueueError;
        return job({ inputText: input.text });
      },
    },
    waitForAiPromptJob: {
      async execute(input) {
        h.waited.push(input);
        if (h.waitError) throw h.waitError;
        return h.waitResult;
      },
    },
    authenticate,
  }));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err instanceof ZodError ? 400 : 500).json({ error: String(err) });
  });
  return app;
}

async function withServer(h: Harness, fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = http.createServer(buildApp(h));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address() as AddressInfo;
    await fn(`http://127.0.0.1:${port}/api/ai/text-jobs`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function harness(overrides: Partial<Harness> = {}): Harness {
  return { enqueued: [], waited: [], waitResult: job(), ...overrides };
}

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('POST: кладёт text-job без проекта, инструкция и текст едут конвертом', async () => {
  const h = harness();
  await withServer(h, async (url) => {
    const response = await post(url, { input: '  Длинный сложный текст  ', instructions: 'Упрости для ребёнка' });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { id: JOB_ID, status: 'queued', createdAt: NOW.toISOString() });
  });
  assert.equal(h.enqueued.length, 1);
  assert.equal(h.enqueued[0]?.mode, 'text');
  assert.equal(h.enqueued[0]?.projectId, null);
  assert.deepEqual(JSON.parse(h.enqueued[0]!.text), { v: 1, instructions: 'Упрости для ребёнка', input: 'Длинный сложный текст' });
});

test('POST: инструкция необязательна, лишние поля и пустой текст отклоняются', async () => {
  const h = harness();
  await withServer(h, async (url) => {
    assert.equal((await post(url, { input: 'Напиши пост про запуск' })).status, 202);
    assert.equal((await post(url, { input: '   ' })).status, 400);
    assert.equal((await post(url, { input: 'x', mode: 'improve' })).status, 400);
  });
  assert.equal(JSON.parse(h.enqueued[0]!.text).instructions, '');
  assert.equal(h.enqueued.length, 1);
});

test('POST: лимит → 429', async () => {
  const h = harness({ enqueueError: new AiPromptRateLimitedError() });
  await withServer(h, async (url) => {
    const response = await post(url, { input: 'x' });
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error, 'rate_limited');
  });
});

test('GET: ждёт с returnLatestOnTimeout и отдаёт незавершённый job без текста', async () => {
  const h = harness({ waitResult: job({ status: 'running' }) });
  await withServer(h, async (url) => {
    const response = await fetch(`${url}/${JOB_ID}?wait=7`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'running');
    assert.equal(body.text, null);
  });
  assert.equal(h.waited[0]?.maxWaitMs, 7000);
  assert.equal(h.waited[0]?.returnLatestOnTimeout, true);
  assert.equal(h.waited[0]?.jobId, JOB_ID);
});

test('GET: готовый job отдаёт text', async () => {
  const finishedAt = new Date('2026-11-05T10:00:20.000Z');
  const h = harness({ waitResult: job({ status: 'succeeded', improvedText: 'Простой текст', finishedAt }) });
  await withServer(h, async (url) => {
    const body = await (await fetch(`${url}/${JOB_ID}`)).json();
    assert.equal(body.status, 'succeeded');
    assert.equal(body.text, 'Простой текст');
    assert.equal(body.finishedAt, finishedAt.toISOString());
  });
  assert.equal(h.waited[0]?.maxWaitMs, 25000);
});

test('GET: не text-job, чужой job и не-uuid — 404', async () => {
  await withServer(harness({ waitResult: job({ mode: 'improve' }) }), async (url) => {
    assert.equal((await fetch(`${url}/${JOB_ID}`)).status, 404);
  });
  await withServer(harness({ waitError: new AiPromptJobAccessDeniedError(JOB_ID) }), async (url) => {
    assert.equal((await fetch(`${url}/${JOB_ID}`)).status, 404);
  });
  const h = harness();
  await withServer(h, async (url) => {
    assert.equal((await fetch(`${url}/not-a-uuid`)).status, 404);
  });
  assert.equal(h.waited.length, 0);
});

test('auth: account-токен проходит, проектный — 403, без авторизации — 401', async () => {
  const h = harness();
  await withServer(h, async (url) => {
    assert.equal((await post(url, { input: 'x' }, { Authorization: 'Bearer account-token' })).status, 202);
    assert.equal((await post(url, { input: 'x' }, { Authorization: 'Bearer project-token' })).status, 403);
    assert.equal((await post(url, { input: 'x' }, { 'x-anonymous': '1' })).status, 401);
  });
  assert.equal(h.enqueued.length, 1);
});
