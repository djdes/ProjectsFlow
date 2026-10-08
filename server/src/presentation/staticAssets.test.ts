import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { mountBuildAssets } from './staticAssets.js';

test('assets: immutable hashed files, real 404 misses, and preserved SPA routing', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pf-assets-'));
  const assets = join(root, 'assets');
  await mkdir(assets);
  await writeFile(join(assets, 'index-ABcd1234.js'), 'export const ready = true;');
  await writeFile(join(assets, 'config.json'), '{}');
  await writeFile(join(root, 'private.txt'), 'must not be exposed');
  const app = express();
  mountBuildAssets(app, '/assets', assets);
  app.get('*', (_req, res) => res.type('html').send('<html>SPA</html>'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const file = await fetch(`${base}/assets/index-ABcd1234.js`);
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-type')!, /javascript/);
  assert.match(file.headers.get('cache-control')!, /max-age=31536000, immutable/);
  assert.equal(await file.text(), 'export const ready = true;');
  for (const method of ['GET', 'HEAD']) {
    const missing = await fetch(`${base}/assets/old-87654321.js`, { method });
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(missing.headers.get('content-type')!, /html/);
  }
  const unversioned = await fetch(`${base}/assets/config.json`);
  assert.equal(unversioned.headers.get('cache-control'), 'no-cache');
  assert.match(await (await fetch(`${base}/login`)).text(), /SPA/);
  const traversal = await fetch(`${base}/assets/..%2fprivate.txt`);
  assert.notEqual(await traversal.text(), 'must not be exposed');
});
