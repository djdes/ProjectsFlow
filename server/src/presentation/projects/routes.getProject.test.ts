import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { projectsRouter } from './routes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import type { Project } from '../../domain/project/Project.js';
import type { ProjectMembership, ProjectRole } from '../../domain/project/ProjectMembership.js';
import type { User } from '../../domain/user/User.js';

// Регресс B3: GET /:id больше НЕ хардкодит role='owner'. Реальная роль резолвится через
// members.findForProject — иначе editor/viewer по прямой ссылке видели бы danger zone.

const FAKE_USER: User = {
  id: 'u1',
  email: 'u1@test.dev',
  displayName: 'Test',
  avatarUrl: null,
  isAdmin: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

function fakeProject(): Project {
  return {
    id: 'p1',
    ownerId: 'creator',
    name: 'Proj',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  } as unknown as Project;
}

// role=null симулирует admin-bypass (getProject прошёл, но membership отсутствует) → 'owner'.
function buildApp(role: ProjectRole | null) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = FAKE_USER;
    next();
  });
  const deps = {
    getProject: { execute: async () => fakeProject() },
    setActiveWorkspaceForProject: async () => {},
    members: {
      findForProject: async (): Promise<ProjectMembership | null> =>
        role ? { projectId: 'p1', userId: FAKE_USER.id, role, joinedAt: new Date(0) } : null,
    },
    notifyProjectChanged: () => {},
  };
  app.use('/api/projects', projectsRouter(deps as never));
  app.use(errorHandler);
  return app;
}

async function withServer(role: ProjectRole | null, fn: (baseUrl: string) => Promise<void>) {
  const server = http.createServer(buildApp(role));
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

for (const role of ['editor', 'viewer'] as const) {
  test(`GET /:id — роль ${role} отдаётся как есть (не 'owner')`, async () => {
    await withServer(role, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/projects/p1`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { project: { role: string } };
      assert.equal(body.project.role, role);
    });
  });
}

test('GET /:id — admin-bypass (membership отсутствует) → fallback owner', async () => {
  await withServer(null, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/projects/p1`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { project: { role: string } };
    assert.equal(body.project.role, 'owner');
  });
});
