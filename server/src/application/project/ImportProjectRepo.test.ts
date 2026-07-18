import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GithubApiError,
  GithubEmptyRepoAlreadyExistsError,
  GithubImportRepoNotEmptyError,
} from '../../domain/github/errors.js';
import type { Project } from '../../domain/project/Project.js';
import { ImportProjectRepo } from './ImportProjectRepo.js';
import { ProjectImportAnalyzer } from './ProjectImportAnalyzer.js';

function storedZip(
  name = 'project/index.html',
  body = '<!doctype html><title>demo</title>',
): Buffer {
  const filename = Buffer.from(name, 'utf8');
  const content = Buffer.from(body, 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(filename.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(filename.length, 28);
  central.writeUInt32LE(0, 42);

  const centralOffset = local.length + filename.length + content.length;
  const centralSize = central.length + filename.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, filename, content, central, filename, eocd]);
}

function makeProject(): Project {
  return {
    id: 'p1', ownerId: 'u1', name: 'MagFlow', icon: null, status: 'active',
    gitRepoUrl: null, kbRepoFullName: null, kbKind: 'none', financeVisibility: 'owner',
    dispatcherUserId: null, multiTaskWorker: false, isInbox: false,
    description: null, coverUrl: null, coverPosition: 50,
    publicSlug: null, isPublic: false, publicIndexing: false,
    publicAppearance: {
      accentColor: '#2383e2', showCover: true, showIcon: true,
      showDescription: true, showTaskMeta: true,
    },
    appRepoFullName: null, siteSlug: 'magflow', createdAt: new Date('2026-01-01'),
  };
}

function makeDeps(options: {
  createError?: Error;
  target?: {
    fullName: string;
    htmlUrl: string;
    defaultBranch: string;
    empty: boolean;
    canPush: boolean;
  } | null;
  importError?: Error;
}) {
  const project = makeProject();
  const calls = {
    creates: 0,
    imports: [] as Array<{ fullName: string; requireEmpty: boolean }>,
    updates: [] as Array<{ gitRepoUrl?: string | null; appRepoFullName?: string | null }>,
    deletes: [] as string[],
  };
  const deps = {
    projects: {
      getById: async () => project,
      update: async (_id: string, patch: { gitRepoUrl?: string | null; appRepoFullName?: string | null }) => {
        calls.updates.push(patch);
        return { ...project, ...patch };
      },
    },
    members: {
      findForProject: async () => ({ projectId: 'p1', userId: 'u1', role: 'editor', joinedAt: new Date() }),
    },
    tokens: {
      getWithTokenByUserId: async () => ({ accessToken: 'token', githubLogin: 'yaroslav' }),
    },
    api: {
      createRepo: async () => {
        calls.creates += 1;
        if (options.createError) throw options.createError;
        return {
          fullName: 'yaroslav/new-repo',
          htmlUrl: 'https://github.com/yaroslav/new-repo',
          defaultBranch: 'main',
        };
      },
      getAuthenticatedUser: async () => ({ login: 'yaroslav', id: '1' }),
      getRepoImportTarget: async () => options.target ?? null,
      importRepoFiles: async (
        _token: string,
        fullName: string,
        _branch: string,
        _files: unknown[],
        _message: string,
        importOptions?: { requireEmpty?: boolean },
      ) => {
        calls.imports.push({ fullName, requireEmpty: importOptions?.requireEmpty === true });
        if (options.importError) throw options.importError;
      },
      deleteRepo: async (_token: string, fullName: string) => { calls.deletes.push(fullName); },
    },
    analyzer: new ProjectImportAnalyzer(),
  };
  return { deps: deps as any, calls };
}

const emptyExisting = {
  fullName: 'yaroslav/magflow_v2',
  htmlUrl: 'https://github.com/yaroslav/magflow_v2',
  defaultBranch: 'main',
  empty: true,
  canPush: true,
};

test('ImportProjectRepo предлагает использовать собственный пустой repo при конфликте имени', async () => {
  const { deps, calls } = makeDeps({
    createError: new GithubApiError(422, 'name already exists'),
    target: emptyExisting,
  });
  await assert.rejects(
    () => new ImportProjectRepo(deps).execute({
      projectId: 'p1', callerUserId: 'u1',
      target: { kind: 'new', name: 'magflow_v2', privateRepo: true },
      archive: storedZip(),
    }),
    (error: unknown) => error instanceof GithubEmptyRepoAlreadyExistsError
      && error.fullName === 'yaroslav/magflow_v2',
  );
  assert.equal(calls.imports.length, 0);
  assert.equal(calls.updates.length, 0);
});

test('ImportProjectRepo загружает ZIP в выбранный пустой repo и не удаляет его', async () => {
  const { deps, calls } = makeDeps({ target: emptyExisting });
  const result = await new ImportProjectRepo(deps).execute({
    projectId: 'p1', callerUserId: 'u1',
    target: { kind: 'existing', fullName: 'yaroslav/magflow_v2' },
    archive: storedZip(),
  });
  assert.equal(result.fullName, 'yaroslav/magflow_v2');
  assert.deepEqual(calls.imports, [{ fullName: 'yaroslav/magflow_v2', requireEmpty: true }]);
  assert.deepEqual(calls.updates, [{
    gitRepoUrl: 'https://github.com/yaroslav/magflow_v2',
    appRepoFullName: 'yaroslav/magflow_v2',
  }]);
  assert.deepEqual(calls.deletes, []);
});

test('ImportProjectRepo не трогает выбранный repo, если в нём уже есть commits', async () => {
  const { deps, calls } = makeDeps({ target: { ...emptyExisting, empty: false } });
  await assert.rejects(
    () => new ImportProjectRepo(deps).execute({
      projectId: 'p1', callerUserId: 'u1',
      target: { kind: 'existing', fullName: 'yaroslav/magflow_v2' },
      archive: storedZip(),
    }),
    GithubImportRepoNotEmptyError,
  );
  assert.equal(calls.imports.length, 0);
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.deletes.length, 0);
});

test('ImportProjectRepo останавливается, если repo перестал быть пустым во время импорта', async () => {
  const { deps, calls } = makeDeps({
    target: emptyExisting,
    importError: new GithubApiError(409, 'Repository is no longer empty'),
  });
  await assert.rejects(
    () => new ImportProjectRepo(deps).execute({
      projectId: 'p1', callerUserId: 'u1',
      target: { kind: 'existing', fullName: 'yaroslav/magflow_v2' },
      archive: storedZip(),
    }),
    GithubImportRepoNotEmptyError,
  );
  assert.equal(calls.updates.length, 0);
  assert.equal(calls.deletes.length, 0);
});

test('ImportProjectRepo повторяет preflight и не мутирует GitHub для Node API', async () => {
  const { deps, calls } = makeDeps({ target: emptyExisting });
  await assert.rejects(
    () => new ImportProjectRepo(deps).execute({
      projectId: 'p1', callerUserId: 'u1',
      target: { kind: 'new', name: 'unsafe-node', privateRepo: true },
      archive: storedZip('project/package.json', JSON.stringify({
        scripts: { start: 'node server.js' },
        dependencies: { express: '^5.0.0' },
      })),
    }),
    /постоянно работающий Node\.js-процесс/,
  );
  assert.equal(calls.creates, 0);
  assert.equal(calls.imports.length, 0);
  assert.equal(calls.updates.length, 0);
});
