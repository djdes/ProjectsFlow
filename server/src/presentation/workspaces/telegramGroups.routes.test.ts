import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { workspacesRouter } from './routes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import type { ManageTelegramWorkGroups } from '../../application/telegram/ManageTelegramWorkGroups.js';
import {
  TelegramGroupDraftElsewhereError,
  TelegramGroupProjectInvalidError,
  TelegramGroupTakenError,
  TelegramGroupTransferRequestedError,
} from '../../domain/telegram/errors.js';
import type { TelegramWorkGroup } from '../../application/telegram/TelegramWorkGroupRepository.js';
import { NotWorkspaceLeadError } from '../../domain/workspace/errors.js';
import type { User } from '../../domain/user/User.js';

const NOW = new Date('2026-11-12T10:00:00Z');

function group(extra: Partial<TelegramWorkGroup> = {}): TelegramWorkGroup {
  return {
    chatId: -1001,
    workspaceId: 'ws1',
    title: 'Команда',
    addedByUserId: 'lead',
    createdAt: NOW,
    status: 'active',
    invitedByTgUserId: null,
    projectIds: [],
    ...extra,
  };
}

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
        groups: [group({ status: 'draft', projectIds: ['p1'] })],
        mainGroup: { chatId: -1005, title: 'Сводки' },
        botUsername: 'ProjectsFlow_Bot',
      }),
    },
    async (url) => {
      const res = await fetch(`${url}/telegram-groups`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), {
        groups: [{ chatId: -1001, title: 'Команда', createdAt: NOW.toISOString(), status: 'draft', mode: 'standard', projectIds: ['p1'], transferRequest: null }],
        mainGroup: { chatId: -1005, title: 'Сводки' },
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

test('POST telegram-groups/:chatId/confirm → active group; viewer → 403', async () => {
  const calls: number[] = [];
  await withApp(
    {
      confirm: async (_ws: string, _actor: string, chatId: number) => {
        calls.push(chatId);
        return group({ chatId });
      },
    },
    async (url) => {
      const res = await fetch(`${url}/telegram-groups/-1001/confirm`, { method: 'POST' });
      assert.equal(res.status, 200);
      assert.equal(((await res.json()) as { group: { status: string } }).group.status, 'active');
      assert.deepEqual(calls, [-1001]);
    },
  );
  await withApp(
    {
      confirm: async () => {
        throw new NotWorkspaceLeadError();
      },
    },
    async (url) => {
      const res = await fetch(`${url}/telegram-groups/-1001/confirm`, { method: 'POST' });
      assert.equal(res.status, 403);
    },
  );
});

test('PUT telegram-groups/:chatId/projects saves the list; foreign project → 400', async () => {
  const P1 = '11111111-1111-4111-8111-111111111111';
  const calls: Array<readonly string[]> = [];
  await withApp(
    {
      setProjects: async (_ws: string, _actor: string, chatId: number, projectIds: readonly string[]) => {
        calls.push(projectIds);
        return group({ chatId, projectIds });
      },
    },
    async (url) => {
      const res = await fetch(`${url}/telegram-groups/-1001/projects`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectIds: [P1] }),
      });
      assert.equal(res.status, 200);
      assert.deepEqual(((await res.json()) as { group: { projectIds: string[] } }).group.projectIds, [P1]);
      const bad = await fetch(`${url}/telegram-groups/-1001/projects`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectIds: ['not-a-uuid'] }),
      });
      assert.equal(bad.status, 400);
      assert.deepEqual(calls, [[P1]]);
    },
  );
  await withApp(
    {
      setProjects: async () => {
        throw new TelegramGroupProjectInvalidError();
      },
    },
    async (url) => {
      const res = await fetch(`${url}/telegram-groups/-1001/projects`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectIds: [P1] }),
      });
      assert.equal(res.status, 400);
      assert.equal(((await res.json()) as { error: string }).error, 'telegram_group_project_invalid');
    },
  );
});

test('POST telegram-groups/:chatId/transfer/:decision → owner decides; draft elsewhere / transfer → 409', async () => {
  const calls: string[] = [];
  await withApp(
    {
      approveTransfer: async (_ws: string, _actor: string, chatId: number) => {
        calls.push(`approve:${chatId}`);
      },
      rejectTransfer: async (_ws: string, _actor: string, chatId: number) => {
        calls.push(`reject:${chatId}`);
      },
      addManual: async () => {
        throw new TelegramGroupDraftElsewhereError();
      },
      list: async () => ({
        groups: [
          {
            ...group({ status: 'disconnected' }),
            transfer: { toWorkspaceId: 'ws2', requestedByUserId: 'u2', targetStatus: 'active' as const, requestedAt: NOW },
            transferWorkspaceName: 'Офис',
          },
        ],
        mainGroup: null,
        botUsername: null,
      }),
    },
    async (url) => {
      assert.equal((await fetch(`${url}/telegram-groups/-1001/transfer/approve`, { method: 'POST' })).status, 204);
      assert.equal((await fetch(`${url}/telegram-groups/-1001/transfer/reject`, { method: 'POST' })).status, 204);
      assert.equal((await fetch(`${url}/telegram-groups/-1001/transfer/steal`, { method: 'POST' })).status, 404);
      assert.deepEqual(calls, ['approve:-1001', 'reject:-1001']);
      const listed = (await (await fetch(`${url}/telegram-groups`)).json()) as {
        groups: Array<{ transferRequest: { workspaceName: string } | null }>;
      };
      assert.equal(listed.groups[0]?.transferRequest?.workspaceName, 'Офис');
      const res = await fetch(`${url}/telegram-groups`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chatId: -1001 }),
      });
      assert.equal(res.status, 409);
      assert.equal(((await res.json()) as { error: string }).error, 'telegram_group_draft_elsewhere');
    },
  );
  await withApp(
    {
      addManual: async () => {
        throw new TelegramGroupTransferRequestedError();
      },
    },
    async (url) => {
      const res = await fetch(`${url}/telegram-groups`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chatId: -1001 }),
      });
      assert.equal(res.status, 409);
      assert.equal(((await res.json()) as { error: string }).error, 'telegram_group_transfer_requested');
    },
  );
});

test('GET /telegram-groups/:chatId/members — сводка участников группы', async () => {
  const calls: Array<[string, string, number]> = [];
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 'lead', email: 'lead@test.dev', displayName: 'Lead', avatarUrl: null, isAdmin: false, createdAt: NOW } as User;
    next();
  });
  app.use(
    '/api/workspaces',
    workspacesRouter({
      appUrl: 'https://app.test',
      telegramGroupMembers: {
        async summary(workspaceId: string, actorUserId: string, chatId: number) {
          calls.push([workspaceId, actorUserId, chatId]);
          return {
            telegramCount: 3,
            linked: [{ tgUserId: 5, userId: 'u5', displayName: 'Иван', avatarUrl: null, status: 'member' as const }],
            botIsAdmin: false,
          };
        },
      },
    } as unknown as Parameters<typeof workspacesRouter>[0]),
  );
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/workspaces/ws1`;
    const res = await fetch(`${base}/telegram-groups/-1001/members`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      telegramCount: 3,
      linked: [{ tgUserId: 5, userId: 'u5', displayName: 'Иван', avatarUrl: null, status: 'member' }],
      botIsAdmin: false,
    });
    assert.deepEqual(calls, [['ws1', 'lead', -1001]]);
    assert.equal((await fetch(`${base}/telegram-groups/abc/members`)).status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
