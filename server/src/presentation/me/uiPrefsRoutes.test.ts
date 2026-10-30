import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { UserRepository } from '../../application/user/UserRepository.js';
import type { UiPrefs } from '../../domain/user/UiPrefs.js';
import { meUiPrefsRouter } from './uiPrefsRoutes.js';
import { errorHandler } from '../middleware/errorHandler.js';

async function harness() {
  const records = new Map<string, UiPrefs>([['alice', { sidebarWidth: 280 }]]);
  const users = {
    async getUiPrefs(id: string) { return records.get(id) ?? {}; },
    async setUiPrefs(id: string, prefs: UiPrefs) { records.set(id, { ...records.get(id), ...prefs }); },
  } as unknown as UserRepository;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // Simulates an authenticated session, never takes an account id from the body.
    const id = req.get('x-test-user');
    if (id) req.user = { id } as NonNullable<typeof req.user>;
    next();
  });
  app.use('/api/me/ui-prefs', meUiPrefsRouter({ users }));
  app.use(errorHandler);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/me/ui-prefs`;
  return {
    records,
    request: (user?: string, prefs?: unknown) => fetch(url, {
      method: prefs === undefined ? 'GET' : 'PUT',
      headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
      ...(prefs === undefined ? {} : { body: JSON.stringify({ prefs }) }),
    }),
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

test('hidden workspaces round-trip per account, preserve other preferences, and can all be restored', async () => {
  const view = await harness();
  try {
    const saved = await view.request('alice', { hiddenTaskWorkspaceIds: ['personal', 'team'] });
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { prefs: { sidebarWidth: 280, hiddenTaskWorkspaceIds: ['personal', 'team'] } });
    assert.deepEqual(await (await view.request('alice')).json(), { prefs: { sidebarWidth: 280, hiddenTaskWorkspaceIds: ['personal', 'team'] } });
    assert.deepEqual(await (await view.request('bob')).json(), { prefs: {} });
    await view.request('alice', { hiddenTaskWorkspaceIds: [] });
    assert.deepEqual(await (await view.request('alice')).json(), { prefs: { sidebarWidth: 280, hiddenTaskWorkspaceIds: [] } });
  } finally { await view.close(); }
});

test('visibility preferences require an authenticated session', async () => {
  const view = await harness();
  try {
    assert.equal((await view.request()).status, 401);
    assert.equal((await view.request(undefined, { hiddenTaskWorkspaceIds: ['team'] })).status, 401);
    assert.deepEqual(view.records.get('alice'), { sidebarWidth: 280 });
  } finally { await view.close(); }
});

test('rejects malformed and unbounded workspace lists before writing preferences', async () => {
  const view = await harness();
  try {
    for (const hiddenTaskWorkspaceIds of ['team', [123], [''], ['x'.repeat(37)], Array(1001).fill('team')]) {
      assert.equal((await view.request('alice', { hiddenTaskWorkspaceIds })).status, 400);
    }
    assert.deepEqual(view.records.get('alice'), { sidebarWidth: 280 });
  } finally { await view.close(); }
});
