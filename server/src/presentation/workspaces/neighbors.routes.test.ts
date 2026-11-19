import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { workspacesRouter } from './routes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import type { User } from '../../domain/user/User.js';

async function withApp(neighborInvites: unknown, fn: (url: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 'lead', email: 'lead@test.dev', displayName: 'Lead', avatarUrl: null, isAdmin: false, createdAt: new Date() } as User;
    next();
  });
  app.use('/api/workspaces', workspacesRouter({ appUrl: 'https://app.test', neighborInvites } as unknown as Parameters<typeof workspacesRouter>[0]));
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/workspaces/dev`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('GET invite-candidates and POST invites/neighbors', async () => {
  const calls: unknown[] = [];
  await withApp(
    {
      list: { execute: async () => [{ userId: 'anna', email: 'anna@x.ru', workspaces: [], invited: false }] },
      invite: {
        execute: async (input: unknown) => {
          calls.push(input);
          return { results: [{ userId: 'anna', status: 'queued' }] };
        },
      },
    },
    async (url) => {
      const list = await fetch(`${url}/invite-candidates`);
      assert.equal(list.status, 200);
      assert.equal(((await list.json()) as { candidates: unknown[] }).candidates.length, 1);
      const bad = await fetch(`${url}/invites/neighbors`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userIds: [], role: 'editor' }),
      });
      assert.equal(bad.status, 400);
      const ok = await fetch(`${url}/invites/neighbors`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userIds: ['anna'], role: 'viewer' }),
      });
      assert.equal(ok.status, 200);
      assert.deepEqual(await ok.json(), { results: [{ userId: 'anna', status: 'queued' }] });
      assert.deepEqual(calls, [{ workspaceId: 'dev', actorUserId: 'lead', userIds: ['anna'], role: 'viewer' }]);
    },
  );
});
