import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CreateProjectRepo } from './CreateProjectRepo.js';
import {
  GithubApiError,
  GithubNotConnectedError,
  GithubRepoNameTakenError,
} from '../../domain/github/errors.js';
import {
  InsufficientProjectRoleError,
  ProjectRepoAlreadyConnectedError,
} from '../../domain/project/errors.js';
import type { Project } from '../../domain/project/Project.js';
import type { ProjectRole } from '../../domain/project/ProjectMembership.js';

function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p1', ownerId: 'owner1', name: 'Обувь Лендинг', icon: null, status: 'active',
    gitRepoUrl: null, kbRepoFullName: null, kbKind: 'none', financeVisibility: 'owner',
    dispatcherUserId: null, multiTaskWorker: false, isInbox: false,
    description: null, coverUrl: null, coverPosition: 50,
    publicSlug: null, isPublic: false, publicIndexing: false, appRepoFullName: null, siteSlug: null,
    createdAt: new Date('2026-01-01'), ...over,
  };
}

type CreateRepoCall = { name: string; description?: string; privateRepo: boolean; autoInit: boolean };

function makeDeps(opts: {
  project: Project;
  role: ProjectRole | null;
  connected: boolean;
  createRepoImpl?: (name: string) => Promise<{ fullName: string; htmlUrl: string }>;
}) {
  const calls = {
    createRepo: [] as CreateRepoCall[],
    updates: [] as Array<{ gitRepoUrl?: string | null }>,
  };
  const projects = {
    async getById(id: string) {
      return opts.project.id === id ? opts.project : null;
    },
    async update(_id: string, patch: { gitRepoUrl?: string | null }) {
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
    async createRepo(_token: string, input: CreateRepoCall) {
      calls.createRepo.push(input);
      if (opts.createRepoImpl) return opts.createRepoImpl(input.name);
      return { fullName: `octocat/${input.name}`, htmlUrl: `https://github.com/octocat/${input.name}` };
    },
  } as any;
  return { deps: { projects, members, tokens, api }, calls };
}

test('CreateProjectRepo: editor + connected → создаёт репо и пишет gitRepoUrl', async () => {
  const { deps, calls } = makeDeps({ project: makeProject(), role: 'editor', connected: true });
  const out = await new CreateProjectRepo(deps).execute('p1', 'u1', {
    name: 'obuv-lending', privateRepo: true,
  });
  assert.equal(out.fullName, 'octocat/obuv-lending');
  assert.equal(out.gitRepoUrl, 'https://github.com/octocat/obuv-lending');
  assert.deepEqual(calls.createRepo, [{
    name: 'obuv-lending',
    description: 'ProjectsFlow: Обувь Лендинг',
    privateRepo: true,
    autoInit: true,
  }]);
  assert.deepEqual(calls.updates, [{
    gitRepoUrl: 'https://github.com/octocat/obuv-lending',
    appRepoFullName: 'octocat/obuv-lending',
  }]);
});

test('CreateProjectRepo: репо уже подключён → ProjectRepoAlreadyConnectedError, GitHub не зовём', async () => {
  const project = makeProject({ gitRepoUrl: 'https://github.com/x/y' });
  const { deps, calls } = makeDeps({ project, role: 'owner', connected: true });
  await assert.rejects(
    () => new CreateProjectRepo(deps).execute('p1', 'owner1', { name: 'z', privateRepo: true }),
    ProjectRepoAlreadyConnectedError,
  );
  assert.equal(calls.createRepo.length, 0);
});

test('CreateProjectRepo: viewer → InsufficientProjectRoleError', async () => {
  const { deps } = makeDeps({ project: makeProject(), role: 'viewer', connected: true });
  await assert.rejects(
    () => new CreateProjectRepo(deps).execute('p1', 'u1', { name: 'z', privateRepo: true }),
    InsufficientProjectRoleError,
  );
});

test('CreateProjectRepo: GitHub не привязан у вызывающего → GithubNotConnectedError', async () => {
  const { deps } = makeDeps({ project: makeProject(), role: 'editor', connected: false });
  await assert.rejects(
    () => new CreateProjectRepo(deps).execute('p1', 'u1', { name: 'z', privateRepo: true }),
    GithubNotConnectedError,
  );
});

test('CreateProjectRepo: GitHub 422 (имя занято) → GithubRepoNameTakenError, gitRepoUrl не пишем', async () => {
  const { deps, calls } = makeDeps({
    project: makeProject(), role: 'editor', connected: true,
    createRepoImpl: async () => { throw new GithubApiError(422, 'name already exists'); },
  });
  await assert.rejects(
    () => new CreateProjectRepo(deps).execute('p1', 'u1', { name: 'taken', privateRepo: true }),
    GithubRepoNameTakenError,
  );
  assert.equal(calls.updates.length, 0);
});

test('CreateProjectRepo: прочие ошибки GitHub пробрасываются как есть', async () => {
  const { deps } = makeDeps({
    project: makeProject(), role: 'editor', connected: true,
    createRepoImpl: async () => { throw new GithubApiError(500, 'boom'); },
  });
  await assert.rejects(
    () => new CreateProjectRepo(deps).execute('p1', 'u1', { name: 'z', privateRepo: true }),
    (e: unknown) => e instanceof GithubApiError && e.status === 500,
  );
});

test('CreateProjectRepo: уже подключён + GitHub не привязан → ProjectRepoAlreadyConnectedError (порядок проверок)', async () => {
  const project = makeProject({ gitRepoUrl: 'https://github.com/x/y' });
  const { deps } = makeDeps({ project, role: 'editor', connected: false });
  await assert.rejects(
    () => new CreateProjectRepo(deps).execute('p1', 'u1', { name: 'z', privateRepo: true }),
    ProjectRepoAlreadyConnectedError,
  );
});
