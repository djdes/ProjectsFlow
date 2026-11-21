import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { isBoardHost, isKnownSpaPath, isSpaNotFound } from './spaRoutes.js';

const routesFile = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../client/src/presentation/app/routes.tsx',
);

test('spaRoutes: every route of client routes.tsx is known (no false 404)', () => {
  // Only the apex-domain branch: the board-subdomain branch (boardHostSlug ? [...]) is
  // never 404 anyway (isBoardHost).
  const full = readFileSync(routesFile, 'utf8');
  const apexStart = full.indexOf('\n    : [');
  assert.ok(apexStart > 0, 'apex branch of createBrowserRouter not found in routes.tsx');
  const src = full.slice(apexStart);
  const paths = [...src.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]!).filter((p) => p !== '*');
  assert.ok(paths.length > 20, `parsed only ${paths.length} routes from routes.tsx`);
  for (const p of paths) {
    const concrete = ('/' + p.replace(/^\//, '')).replace(/:[A-Za-z]+/g, 'x1');
    assert.ok(isKnownSpaPath(concrete), `client route "${p}" is missing in spaRoutes.ts`);
  }
});

test('spaRoutes: real links from notifications and digests stay 200', () => {
  for (const p of [
    '/', '/login', '/projects/abc', '/projects/abc/', '/projects/abc/tasks/t1',
    '/projects/abc/monitoring', '/projects/abc/overview', '/inbox', '/p/my-board',
    '/p/my-board/t/42', '/invite/tok', '/reset-password', '/device', '/admin',
    '/workspaces/w1/settings', '/ai/c/c1',
  ]) assert.equal(isKnownSpaPath(p), true, p);
});

test('spaRoutes: unknown paths are 404 on the apex, never on a board subdomain', () => {
  for (const p of ['/no-such-page', '/wp-login.php', '/favicon-old.png', '/projects', '/projects/a/b/c/d', '/admin/x']) {
    assert.equal(isSpaNotFound(p, 'projectsflow.ru'), true, p);
    assert.equal(isSpaNotFound(p, 'localhost:4317'), true, p);
    assert.equal(isSpaNotFound(p, 'my-board.projectsflow.ru'), false, p);
  }
  assert.equal(isBoardHost('www.projectsflow.ru'), false);
  assert.equal(isBoardHost('a.b.projectsflow.ru'), false);
  assert.equal(isBoardHost('Board.ProjectsFlow.ru:443'), true);
  assert.equal(isBoardHost(undefined), false);
});

test('spaRoutes: status 404 keeps the SPA body and adds noindex', async (t) => {
  const app = express();
  app.get('*', (req, res) => {
    if (isSpaNotFound(req.path, req.get('host'))) {
      res.status(404);
      res.setHeader('X-Robots-Tag', 'noindex');
    }
    res.type('html').send('<html>SPA</html>');
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  t.after(() => new Promise<void>((r) => server.close(() => r())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const miss = await fetch(`${base}/no-such-page`);
  assert.equal(miss.status, 404);
  assert.equal(miss.headers.get('x-robots-tag'), 'noindex');
  assert.equal(await miss.text(), '<html>SPA</html>');
  const hit = await fetch(`${base}/projects/p1`);
  assert.equal(hit.status, 200);
  assert.equal(hit.headers.get('x-robots-tag'), null);
});
