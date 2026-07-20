import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GetProjectSite, type ProjectPackageJsonReader } from './GetProjectSite.js';

/**
 * Классификатор проверен отдельно (projectRuntimeKind.test.ts). Здесь проверяется то, что
 * решает use-case: КОГДА вообще спрашивать про вид проекта и что делать, когда источник молчит
 * или падает. Цена ошибки несимметрична — лишний поход в GitHub это лишняя латентность, а
 * необработанное исключение здесь ломает вкладку «Сайт проекта» целиком.
 */

const project = { id: 'p1', siteSlug: 'demo', ownerId: 'u1' };

const SERVER_APP = JSON.stringify({
  scripts: { start: 'node server.js' },
  dependencies: { mysql2: '^3' },
});

function build(options: {
  deployed?: boolean;
  packageJson?: ProjectPackageJsonReader;
}): GetProjectSite {
  const artifact = options.deployed
    ? { slug: 'demo', publishedAt: new Date('2026-07-01T10:00:00Z'), fileCount: 12 }
    : null;
  return new GetProjectSite({
    projects: { async getById() { return project; } } as never,
    members: {
      async findForProject(projectId: string, userId: string) {
        return { projectId, userId, role: 'owner', joinedAt: new Date() };
      },
    } as never,
    sites: { async getByProject() { return artifact; } } as never,
    storage: { async listRoutes() { return ['/', '/about']; } } as never,
    ...(options.packageJson ? { packageJson: options.packageJson } : {}),
  });
}

test('без reader-а поведение прежнее: вид проекта не определяется', async () => {
  const site = await build({}).execute('p1', 'u1');
  assert.equal(site.runtime, null);
});

test('проект со своим сервером и без деплоя распознаётся вместе с причинами', async () => {
  const site = await build({ packageJson: { async read() { return SERVER_APP; } } }).execute('p1', 'u1');
  assert.equal(site.runtime?.kind, 'server_app');
  assert.ok((site.runtime?.reasons.length ?? 0) > 0, 'вердикт без причин бесполезен для UI');
});

test('у задеплоенного сайта вид не определяется — он уже работает', async () => {
  let calls = 0;
  const site = await build({
    deployed: true,
    packageJson: { async read() { calls += 1; return SERVER_APP; } },
  }).execute('p1', 'u1');

  assert.equal(site.runtime, null);
  // Не просто null в ответе: похода в GitHub быть не должно вовсе, иначе каждое открытие
  // рабочего сайта тянет за собой лишний внешний запрос.
  assert.equal(calls, 0);
});

test('падение источника не ломает выдачу сайта', async () => {
  const site = await build({
    packageJson: { async read() { throw new Error('GitHub 503'); } },
  }).execute('p1', 'u1');

  assert.equal(site.runtime, null);
  assert.equal(site.siteSlug, 'demo');
});

// Отдельный случай: reader вернул null (нет package.json / нет токена / приватный репозиторий).
// Показывать 'unknown' в UI нельзя — из него нечего сказать, а поле в ответе намекнёт клиенту,
// что вердикт есть.
test('неопределимый проект отдаётся как null, а не как unknown', async () => {
  const site = await build({ packageJson: { async read() { return null; } } }).execute('p1', 'u1');
  assert.equal(site.runtime, null);
});

test('обычная статика распознаётся как static — оптимистичный текст остаётся заслуженным', async () => {
  const vite = JSON.stringify({ scripts: { build: 'vite build' }, devDependencies: { vite: '^5' } });
  const site = await build({ packageJson: { async read() { return vite; } } }).execute('p1', 'u1');
  assert.equal(site.runtime?.kind, 'static');
});

test('reader получает id проекта и того, кто смотрит', async () => {
  const seen: Array<[string, string]> = [];
  await build({
    packageJson: { async read(projectId, callerUserId) { seen.push([projectId, callerUserId]); return null; } },
  }).execute('p1', 'u1');
  assert.deepEqual(seen, [['p1', 'u1']]);
});
