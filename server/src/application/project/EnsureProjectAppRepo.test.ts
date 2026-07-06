import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EnsureProjectAppRepo } from './EnsureProjectAppRepo.js';
import { GithubNotConnectedError } from '../../domain/github/errors.js';
import { InsufficientProjectRoleError } from '../../domain/project/errors.js';
import type { Project } from '../../domain/project/Project.js';
import type { ProjectRole } from '../../domain/project/ProjectMembership.js';

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p1', ownerId: 'owner1', name: 'Обувь Лендинг', icon: null, status: 'active',
    gitRepoUrl: null, kbRepoFullName: null, kbKind: 'none', financeVisibility: 'owner',
    dispatcherUserId: null, multiTaskWorker: false, isInbox: false,
    description: null, coverUrl: null, coverPosition: 50,
    publicSlug: null, isPublic: false, publicIndexing: false, appRepoFullName: null,
    createdAt: new Date('2026-01-01'), ...over,
  };
}

type Calls = { createRepo: string[]; updates: Array<{ appRepoFullName?: string | null }> };

function makeDeps(opts: {
  project: Project;
  role: ProjectRole | null;
  connected: boolean;
  createRepoImpl?: (name: string) => Promise<{ fullName: string; htmlUrl: string }>;
}) {
  const calls: Calls = { createRepo: [], updates: [] };
  const projects = {
    async getById(id: string) {
      return opts.project.id === id ? opts.project : null;
    },
    async update(_id: string, patch: { appRepoFullName?: string | null }) {
      calls.updates.push(patch);
      return { ...opts.project, ...patch };
    },
  } as any;
  const members = {
    async findForProject(projectId: string, userId: string) {
      return opts.role ? { projectId, userId, role: opts.role, joinedAt: new Date() } : null;
    },
  } as any;
  const tokens = {
    async getWithTokenByUserId(userId: string) {
      return opts.connected ? { accessToken: `tok-${userId}`, githubLogin: 'octocat' } : null;
    },
  } as any;
  const api = {
    async createRepo(_token: string, input: { name: string }) {
      calls.createRepo.push(input.name);
      if (opts.createRepoImpl) return opts.createRepoImpl(input.name);
      return { fullName: `octocat/${input.name}`, htmlUrl: 'https://github.com/octocat/x' };
    },
    async getAuthenticatedUser() {
      return { login: 'octocat', id: '1' };
    },
  } as any;
  return { deps: { projects, members, tokens, api }, calls };
}

test('EnsureProjectAppRepo: owner + connected → создаёт репо и сохраняет fullName', async () => {
  const { deps, calls } = makeDeps({ project: makeProject(), role: 'owner', connected: true });
  const out = await new EnsureProjectAppRepo(deps).execute('p1', 'owner1');
  assert.equal(out.fullName, 'octocat/pf-obuv-lending-p1');
  assert.deepEqual(calls.createRepo, ['pf-obuv-lending-p1']);
  assert.deepEqual(calls.updates, [
    { appRepoFullName: 'octocat/pf-obuv-lending-p1', gitRepoUrl: 'https://github.com/octocat/pf-obuv-lending-p1' },
  ]);
});

test('EnsureProjectAppRepo: уже есть app-репо → идемпотентно, без createRepo', async () => {
  const project = makeProject({ appRepoFullName: 'octocat/pf-existing' });
  const { deps, calls } = makeDeps({ project, role: 'owner', connected: true });
  const out = await new EnsureProjectAppRepo(deps).execute('p1', 'owner1');
  assert.equal(out.fullName, 'octocat/pf-existing');
  assert.equal(calls.createRepo.length, 0);
  assert.equal(calls.updates.length, 0);
});

test('EnsureProjectAppRepo: GitHub не привязан → GithubNotConnectedError', async () => {
  const { deps } = makeDeps({ project: makeProject(), role: 'owner', connected: false });
  await assert.rejects(
    () => new EnsureProjectAppRepo(deps).execute('p1', 'owner1'),
    GithubNotConnectedError,
  );
});

test('EnsureProjectAppRepo: имя занято (422) → reuse существующего репо', async () => {
  const { deps, calls } = makeDeps({
    project: makeProject(),
    role: 'owner',
    connected: true,
    createRepoImpl: async () => {
      throw Object.assign(new Error('name already exists on this account'), { status: 422 });
    },
  });
  const out = await new EnsureProjectAppRepo(deps).execute('p1', 'owner1');
  assert.equal(out.fullName, 'octocat/pf-obuv-lending-p1');
  assert.deepEqual(calls.updates, [
    { appRepoFullName: 'octocat/pf-obuv-lending-p1', gitRepoUrl: 'https://github.com/octocat/pf-obuv-lending-p1' },
  ]);
});

test('EnsureProjectAppRepo: editor (не owner) → InsufficientProjectRoleError', async () => {
  const { deps } = makeDeps({ project: makeProject(), role: 'editor', connected: true });
  await assert.rejects(
    () => new EnsureProjectAppRepo(deps).execute('p1', 'owner1'),
    InsufficientProjectRoleError,
  );
});
