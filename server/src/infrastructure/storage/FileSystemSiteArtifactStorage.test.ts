import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemSiteArtifactStorage } from './FileSystemSiteArtifactStorage.js';

test('listRoutes отдаёт только HTML entrypoints как безопасные paths', async () => {
  const storage = new FileSystemSiteArtifactStorage(mkdtempSync(join(tmpdir(), 'pf-sites-')));
  await storage.replaceSite('demo', [
    { path: 'index.html', data: Buffer.from('home') },
    { path: 'catalog/index.html', data: Buffer.from('catalog') },
    { path: 'checkout.html', data: Buffer.from('checkout') },
    { path: 'assets/app.js', data: Buffer.from('js') },
  ]);
  assert.deepEqual(await storage.listRoutes('demo'), ['/', '/catalog', '/checkout']);
});
