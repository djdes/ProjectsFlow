import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { workspacesRouter } from './routes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import type { ManageTelegramWorkGroups } from '../../application/telegram/ManageTelegramWorkGroups.js';
import { TelegramGroupTakenError } from '../../domain/telegram/errors.js';
import { NotWorkspaceLeadError } from '../../domain/workspace/errors.js';
import type { User } from '../../domain/user/User.js';

const NOW = new Date('2026-11-12T10:00:00Z');

async function withApp(
  telegramGroups: Partial<ManageTelegramWorkGroups>,
  fn: (url: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 'lead', email: 'lead@test.dev', displayName: 'Lead', avatarUrl: null, isAdmin: false, createdAt: NOW } as User;
    next();
  });
  app.use(
    '/api/workspaces',
    workspacesRouter({
      appUrl: 'https://app.test',
      telegramGroups: telegramGroups as ManageTelegramWorkGroups,
    } as unknown as Parameters<typeof workspacesRouter>[0]),
  );
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/workspaces/ws1`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('GET telegram-groups lists the groups and the bot username', async () => {
  await withApp(
    {
      list: async () => ({
        groups: [{ chatId: -1001, workspaceId: 'ws1', title: 'Команда', addedByUserId: 'lead', createdAt: NOW }],
        botUsername: 'ProjectsFlow_Bot',
      }),
    },
    async (url) => {
      const res = await fetch(`${url}/telegram-groups`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), {
        groups: [{ chatId: -1001, title: 'Команда', createdAt: NOW.toISOString() }],
        botUsername: 'ProjectsFlow_Bot',
      });
    },
  );
});

test('POST telegram-groups/link returns the deep link (purpose defaults to work)', async () => {
  const calls: string[] = [];
  await withApp(
    {
      createLink: async (_ws: string, _actor: string, purpose: 'work' | 'main') => {
        calls.push(purpose);
        return { url: 'https://t.me/ProjectsFlow_Bot?startgroup=wg_x', expiresAt: NOW };
      },
    },
    async (url) => {
      const res = await fetch(`${url}/telegram-groups/link`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), {
        url: 'https://t.me/ProjectsFlow_Bot?startgroup=wg_x',
        expiresAt: NOW.toISOString(),
      });
      assert.deepEqual(calls, ['work']);
    },
  );
});

test('POST telegram-groups validates the id and maps a taken group to 409', async () => {
  await withApp(
    {
      addManual: async () => {
        throw new TelegramGroupTakenError();
      },
    },
    async (url) => {
      const bad = await fetch(`${url}/telegram-groups`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chatId: 42 }),
      });
      assert.equal(bad.status, 400);
      const taken = await fetch(`${url}/telegram-groups`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chatId: -1002 }),
      });
      assert.equal(taken.status, 409);
      assert.equal(((await taken.json()) as { error: string }).error, 'telegram_group_taken');
    },
  );
});

test('DELETE telegram-groups/:chatId → 204, viewer → 403', async () => {
  let removed: number | null = null;
  await withApp(
    {
      remove: async (_ws: string, _actor: string, chatId: number) => {
        removed = chatId;
      },
    },
    async (url) => {
      const res = await fetch(`${url}/telegram-groups/-1001`, { method: 'DELETE' });
      assert.equal(res.status, 204);
      assert.equal(removed, -1001);
    },
  );
  await withApp(
    {
      remove: async () => {
        throw new NotWorkspaceLeadError();
      },
    },
    async (url) => {
      const res = await fetch(`${url}/telegram-groups/-1001`, { method: 'DELETE' });
      assert.equal(res.status, 403);
    },
  );
});
