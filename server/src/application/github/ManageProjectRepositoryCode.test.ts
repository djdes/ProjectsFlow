import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GithubRepoFileConflictError,
  GithubRepoFileInvalidError,
  GithubRepoFileRestrictedError,
} from '../../domain/github/errors.js';
import { InsufficientProjectRoleError, ProjectNotFoundError } from '../../domain/project/errors.js';
import type { Project } from '../../domain/project/Project.js';
import type { ProjectRole } from '../../domain/project/ProjectMembership.js';
import { ManageProjectRepositoryCode } from './ManageProjectRepositoryCode.js';

function project(): Project {
  return {
    id: 'project-a', ownerId: 'owner', name: 'App', icon: null, status: 'active',
    gitRepoUrl: 'https://github.com/acme/app.git', kbRepoFullName: null, kbKind: 'none',
    financeVisibility: 'owner', dispatcherUserId: null, multiTaskWorker: false, isInbox: false,
    description: null, coverUrl: null, coverPosition: 50, publicSlug: null, isPublic: false,
    publicIndexing: false, appRepoFullName: null, siteSlug: null, createdAt: new Date('2026-01-01'),
  };
}

function fixture(role: ProjectRole | null = 'editor') {
  const putCalls: unknown[] = [];
  const activityCalls: unknown[] = [];
  const files = new Map([
    ['src/main.ts', { path: 'src/main.ts', sha: 'sha-old', size: 18, content: 'export const a = 1;' }],
  ]);
  const api = {
    async listRepoTreeRecursive(_token: string, fullName: string) {
      assert.equal(fullName, 'acme/app');
      return { entries: [
        { path: 'src', sha: 'tree', type: 'dir', size: 0 },
        { path: 'src/main.ts', sha: 'sha-old', type: 'file', size: 18 },
        { path: '.env', sha: 'secret', type: 'file', size: 10 },
        { path: 'logo.png', sha: 'image', type: 'file', size: 10 },
      ], truncated: false };
    },
    async getRepoFile(_token: string, _fullName: string, path: string) {
      return files.get(path) ?? null;
    },
    async putRepoFile(input: unknown) {
      putCalls.push(input);
      return { sha: 'sha-new' };
    },
  };
  const deps = {
    projects: { async getById(id: string) { return id === 'project-a' ? project() : null; } },
    members: { async findForProject(projectId: string, userId: string) {
      return role ? { projectId, userId, role, joinedAt: new Date() } : null;
    } },
    tokens: { async getWithTokenByUserId() { return { accessToken: 'token-a', githubLogin: 'owner' }; } },
    api,
    delegations: {
      async listEnabledForProject() { return []; },
      async logAccess() {},
    },
    users: { async getManyByIds() { return []; } },
    activity: { async record(input: unknown) { activityCalls.push(input); } },
  } as never;
  return { service: new ManageProjectRepositoryCode(deps), files, putCalls, activityCalls };
}

test('repository code tree is project-scoped and marks protected files', async () => {
  const { service } = fixture();
  const tree = await service.getTree('project-a', 'editor');
  assert.equal(tree.fullName, 'acme/app');
  assert.equal(tree.entries.find((item) => item.path === '.env')?.restrictedReason, 'sensitive');
  assert.equal(tree.entries.find((item) => item.path === 'logo.png')?.restrictedReason, 'binary');
  assert.equal(tree.entries.find((item) => item.path === 'src/main.ts')?.restricted, false);
  await assert.rejects(() => service.getTree('project-b', 'editor'), ProjectNotFoundError);
});

test('repository code rejects traversal and protected files before GitHub read', async () => {
  const { service } = fixture();
  await assert.rejects(() => service.getFile('project-a', 'editor', '../other/.env'), GithubRepoFileInvalidError);
  await assert.rejects(
    () => service.getFile('project-a', 'editor', '.env'),
    (error: unknown) => error instanceof GithubRepoFileRestrictedError && error.reason === 'sensitive',
  );
  await assert.rejects(
    () => service.getFile('project-a', 'editor', 'logo.png'),
    (error: unknown) => error instanceof GithubRepoFileRestrictedError && error.reason === 'binary',
  );
});

test('repository code reads text and saves using current SHA with activity audit', async () => {
  const { service, putCalls, activityCalls } = fixture();
  const file = await service.getFile('project-a', 'editor', 'src/main.ts');
  assert.equal(file.content, 'export const a = 1;');
  const result = await service.saveFile('project-a', 'editor', {
    path: 'src/main.ts', sha: 'sha-old', content: 'export const a = 2;', message: 'fix: update main',
  });
  assert.equal(result.sha, 'sha-new');
  assert.deepEqual(putCalls, [{
    accessToken: 'token-a', owner: 'acme', repo: 'app', path: 'src/main.ts',
    content: 'export const a = 2;', message: 'fix: update main', sha: 'sha-old',
  }]);
  assert.equal(activityCalls.length, 1);
});

test('repository code prevents stale SHA overwrite', async () => {
  const { service, putCalls } = fixture();
  await assert.rejects(
    () => service.saveFile('project-a', 'editor', { path: 'src/main.ts', sha: 'stale', content: 'changed' }),
    (error: unknown) => error instanceof GithubRepoFileConflictError && error.currentSha === 'sha-old',
  );
  assert.equal(putCalls.length, 0);
});

test('viewer cannot save repository file', async () => {
  const { service } = fixture('viewer');
  await assert.rejects(
    () => service.saveFile('project-a', 'viewer', { path: 'src/main.ts', sha: 'sha-old', content: 'changed' }),
    InsufficientProjectRoleError,
  );
});
