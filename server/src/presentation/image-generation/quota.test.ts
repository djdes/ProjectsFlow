import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import express from 'express';
import type { AuthenticateAgentToken } from '../../application/agent/AuthenticateAgentToken.js';
import { AgentTokenInvalidError } from '../../domain/agent/errors.js';
import { ImageGenerationService } from '../../application/image-generation/ImageGenerationService.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { imageGenerationRouter } from './routes.js';

test('quota resolves before the UUID route, requires authentication and isolates account capacity', async () => {
  let creations = 0;
  const service = new ImageGenerationService({
    dispatcherUserId: 'dispatcher', idGen: () => 'unused',
    jobs: {
      async quota(user) { return { active: user === 'owner' ? 1 : 0, remaining: user === 'owner' ? 9 : 10, releaseAfterSeconds: user === 'owner' ? [123] : [] }; },
      async create() { creations++; throw Error('Quota must not create a job'); },
      async get() { return null; }, async list() { return []; }, async claim() { return null; }, async complete() { return true; },
    },
    storage: { async put() { throw Error('Quota must not store an image'); }, async read() { return null; }, async delete() {} },
  });
  const authenticate = { async execute(token: string) {
    if (token === 'invalid') throw new AgentTokenInvalidError();
    return { user: { id: token }, token: { id: 'test', scopeKind: token === 'project' ? 'project' : 'account' } };
  } } as unknown as AuthenticateAgentToken;
  const app = express();
  app.use('/api/ai/image-jobs', imageGenerationRouter(service, authenticate));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing test listener');
  const url = `http://127.0.0.1:${address.port}/api/ai/image-jobs/quota`;
  const request = (token?: string) => fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  try {
    assert.equal((await request()).status, 401);
    assert.equal((await request('invalid')).status, 401);
    assert.equal((await request('project')).status, 403);
    const response = await request('owner');
    assert.equal(response.status, 200, 'quota must not be interpreted as a UUID');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await response.json(), { active: 1, remaining: 9, releaseAfterSeconds: [123] });
    assert.deepEqual(await (await request('other')).json(), { active: 0, remaining: 10, releaseAfterSeconds: [] });
    assert.equal(creations, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
