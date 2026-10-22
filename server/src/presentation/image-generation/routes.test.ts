import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { imageGenerationRouter, imageGenerationAgentRouter } from './routes.js';
import { ImageGenerationService } from '../../application/image-generation/ImageGenerationService.js';
import type { ImageGeneration } from '../../domain/image-generation/ImageGeneration.js';
import { ImageGenerationError } from '../../domain/image-generation/ImageGeneration.js';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';
import { errorHandler } from '../middleware/errorHandler.js';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const lease = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const conversationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

async function withApi(run: (url: string) => Promise<void>) {
  const job: ImageGeneration = { id, userId: 'owner', dispatcherUserId: 'dispatcher', prompt: 'Фото кружки', status: 'succeeded', claimToken: lease, storageKey: 'private/photo.png', errorMessage: null, createdAt: new Date(), startedAt: new Date(), finishedAt: new Date() };
  const service = new ImageGenerationService({
    conversations: {
      async get(userId, chatId) {
        if (userId !== 'owner' || chatId !== conversationId) throw new ImageGenerationError(404, 'Чат не найден');
        return { id: conversationId } as never;
      },
    },
    jobs: {
      async create(input) { return { ...job, ...input, status: 'queued', storageKey: null }; },
      async list(userId, chatId) { return userId === job.userId && (!chatId || chatId === job.conversationId) ? [job] : []; },
      async get(key) { return key === id ? job : null; },
      async claim() { job.status = 'running'; return job; },
      async complete() { return true; },
    },
    storage: { async put() {}, async read(key) { return key === 'private/photo.png' ? { data: Buffer.from('private image bytes'), mimeType: 'image/png' } : null; }, async delete() {} },
    dispatcherUserId: 'dispatcher', idGen: () => id,
  });
  const app = express();
  app.use(express.json());
  // This represents an already authenticated cookie session, only inside the test app.
  app.use((req, _res, next) => { if (req.headers['x-test-user']) req.user = { id: req.headers['x-test-user'] } as never; next(); });
  app.use('/api/ai/image-jobs', imageGenerationRouter(service));
  const authenticate = {
    async execute(token: string) {
      return { user: { id: token === 'other' ? 'other' : 'dispatcher' }, token: { id: 'token', scopeKind: token === 'project' ? 'project' : 'account' } };
    },
  } as unknown as AuthenticateAgentToken;
  app.use('/api/agent/image-jobs', imageGenerationAgentRouter(service, authenticate));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
}

test('photo API requires a session; only the author can list and download their photos', async () => {
  await withApi(async base => {
    assert.equal((await fetch(base + '/api/ai/image-jobs')).status, 401);
    const owner = { 'x-test-user': 'owner' };
    const listing = await (await fetch(base + '/api/ai/image-jobs', { headers: owner })).json();
    assert.equal(listing.items.length, 1);
    assert.equal('claimToken' in listing.items[0], false);
    assert.equal('storageKey' in listing.items[0], false);
    assert.deepEqual(await (await fetch(base + '/api/ai/image-jobs', { headers: { 'x-test-user': 'other' } })).json(), { items: [] });
    assert.equal((await fetch(`${base}/api/ai/image-jobs/${id}/image`, { headers: { 'x-test-user': 'other' } })).status, 404);
    const image = await fetch(`${base}/api/ai/image-jobs/${id}/image`, { headers: owner });
    assert.equal(image.status, 200);
    assert.match(image.headers.get('cache-control')!, /private, no-store/);
    assert.equal(await image.text(), 'private image bytes');
  });
});

test('photo API queues a prompt and the bridge accepts only the configured account dispatcher', async () => {
  await withApi(async base => {
    const response = await fetch(base + '/api/ai/image-jobs', { method: 'POST', headers: { 'x-test-user': 'owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'Фото чашки' }) });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).status, 'queued');
    for (const [token, expected] of [['', 401], ['project', 403], ['other', 403], ['dispatcher', 200]] as const) {
      const claim = await fetch(base + '/api/agent/image-jobs/claim', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} });
      assert.equal(claim.status, expected, token || 'anonymous');
    }
  });
});

test('photo API binds a request to an accessible chat and rejects foreign or invalid chat IDs', async () => {
  await withApi(async base => {
    const create = (chatId: string, user = 'owner') => fetch(base + '/api/ai/image-jobs', {
      method: 'POST', headers: { 'x-test-user': user, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Фото чашки', conversationId: chatId }),
    });
    const response = await create(conversationId);
    assert.equal(response.status, 202);
    assert.equal((await response.json()).conversationId, conversationId);
    assert.equal((await create(conversationId, 'other')).status, 404);
    assert.equal((await create(id)).status, 404);
    assert.equal((await create('not-a-uuid')).status, 400);
    assert.equal((await fetch(`${base}/api/ai/image-jobs?conversationId=${conversationId}`, { headers: { 'x-test-user': 'other' } })).status, 404);
    const listing = await (await fetch(`${base}/api/ai/image-jobs?conversationId=${conversationId}`, { headers: { 'x-test-user': 'owner' } })).json();
    assert.deepEqual(listing.items, [], 'standalone photos do not appear in an unrelated chat');
  });
});
