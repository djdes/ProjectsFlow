import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { invitesRouter } from './routes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import type { GetInviteByToken } from '../../application/project/GetInviteByToken.js';
import type { AcceptWorkspaceInvite } from '../../application/workspace/AcceptWorkspaceInvite.js';
import type { AcceptProjectInvite } from '../../application/project/AcceptProjectInvite.js';
import {
  WorkspaceInviteAlreadyUsedError,
  WorkspaceInviteNotFoundError,
} from '../../domain/workspace/errors.js';
import { ProjectInviteNotFoundError } from '../../domain/project/errors.js';
import type { User } from '../../domain/user/User.js';

const FAKE_USER: User = {
  id: 'u1',
  email: 'u1@test.dev',
  displayName: 'Test User',
  avatarUrl: null,
  isAdmin: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

// GetInviteByToken не участвует в accept-развилке — заглушка, чтобы удовлетворить Deps.
const NOOP_GET_BY_TOKEN = {
  execute: async () => {
    throw new Error('not used in these tests');
  },
} as unknown as GetInviteByToken;

type BuildAppOpts = {
  acceptWorkspace: Pick<AcceptWorkspaceInvite, 'execute'>;
  acceptProject: Pick<AcceptProjectInvite, 'execute'>;
};

function buildApp(opts: BuildAppOpts) {
  const app = express();
  app.use(express.json());
  // Симулируем sessionFromCookie: любой запрос — от FAKE_USER.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = FAKE_USER;
    next();
  });
  app.use(
    '/api/invites',
    invitesRouter({
      getByToken: NOOP_GET_BY_TOKEN,
      acceptWorkspace: opts.acceptWorkspace as AcceptWorkspaceInvite,
      acceptProject: opts.acceptProject as AcceptProjectInvite,
    }),
  );
  app.use(errorHandler);
  return app;
}

async function withServer(
  opts: BuildAppOpts,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(buildApp(opts));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address() as AddressInfo;
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

test('POST /:token/accept — workspace-токен резолвится через AcceptWorkspaceInvite, project fallback не вызывается', async () => {
  let workspaceCalls = 0;
  let projectCalls = 0;
  await withServer(
    {
      acceptWorkspace: {
        execute: async (token: string, userId: string) => {
          workspaceCalls++;
          assert.equal(token, 'ws-token');
          assert.equal(userId, FAKE_USER.id);
          return { workspaceId: 'w1' };
        },
      },
      acceptProject: {
        execute: async () => {
          projectCalls++;
          return { projectId: 'p1' };
        },
      },
    },
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/invites/ws-token/accept`, { method: 'POST' });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { workspaceId?: string };
      assert.deepEqual(body, { workspaceId: 'w1' });
    },
  );
  assert.equal(workspaceCalls, 1);
  assert.equal(projectCalls, 0);
});

test('POST /:token/accept — легаси project-токен: WorkspaceInviteNotFoundError → фоллбэк на AcceptProjectInvite', async () => {
  let workspaceCalls = 0;
  let projectCalls = 0;
  await withServer(
    {
      acceptWorkspace: {
        execute: async () => {
          workspaceCalls++;
          throw new WorkspaceInviteNotFoundError();
        },
      },
      acceptProject: {
        execute: async (token: string, userId: string) => {
          projectCalls++;
          assert.equal(token, 'legacy-token');
          assert.equal(userId, FAKE_USER.id);
          return { projectId: 'p1' };
        },
      },
    },
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/invites/legacy-token/accept`, { method: 'POST' });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { projectId?: string };
      assert.deepEqual(body, { projectId: 'p1' });
    },
  );
  assert.equal(workspaceCalls, 1);
  assert.equal(projectCalls, 1);
});

test('POST /:token/accept — токен не найден ни у одного из типов → 404 invite_not_found из фоллбэка', async () => {
  await withServer(
    {
      acceptWorkspace: {
        execute: async () => {
          throw new WorkspaceInviteNotFoundError();
        },
      },
      acceptProject: {
        execute: async () => {
          throw new ProjectInviteNotFoundError();
        },
      },
    },
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/invites/unknown-token/accept`, { method: 'POST' });
      assert.equal(res.status, 404);
      const body = (await res.json()) as { error?: string };
      assert.equal(body.error, 'invite_not_found');
    },
  );
});

test('POST /:token/accept — ws-инвайт найден, но уже использован: ошибка НЕ маскируется фоллбэком на project', async () => {
  let projectCalls = 0;
  await withServer(
    {
      acceptWorkspace: {
        execute: async () => {
          throw new WorkspaceInviteAlreadyUsedError();
        },
      },
      acceptProject: {
        execute: async () => {
          projectCalls++;
          return { projectId: 'p1' };
        },
      },
    },
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/invites/used-token/accept`, { method: 'POST' });
      assert.equal(res.status, 410);
      const body = (await res.json()) as { error?: string };
      assert.equal(body.error, 'invite_used');
    },
  );
  // Фоллбэк — только на "это не ws-токен" (NotFound); прочие ошибки ws-инвайта пробрасываются как есть.
  assert.equal(projectCalls, 0);
});

test('POST /:token/accept — без сессии (req.user отсутствует) → 401', async () => {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/invites',
    invitesRouter({
      getByToken: NOOP_GET_BY_TOKEN,
      acceptWorkspace: { execute: async () => ({ workspaceId: 'w1' }) } as AcceptWorkspaceInvite,
      acceptProject: { execute: async () => ({ projectId: 'p1' }) } as AcceptProjectInvite,
    }),
  );
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/invites/any-token/accept`, {
      method: 'POST',
    });
    assert.equal(res.status, 401);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
