import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ContainerProvider } from '@/infrastructure/di/container';
import { useHiddenTaskWorkspaces } from './useHiddenTaskWorkspaces';
Object.assign(globalThis, { React });

async function harness() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const state = { current: null as ReturnType<typeof useHiddenTaskWorkspaces> | null };
  function Probe() {
    state.current = useHiddenTaskWorkspaces();
    return null;
  }
  await act(async () => { root.render(React.createElement(ContainerProvider, null, React.createElement(Probe))); });
  return { state, async close() { await act(async () => root.unmount()); host.remove(); } };
}

test('loads account visibility, saves only that preference and restores it after remount', async t => {
  let prefs = { hiddenTaskWorkspaceIds: ['personal'], sidebarWidth: 280 };
  const writes: unknown[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    if (init.method === 'PUT') {
      const body = JSON.parse(init.body as string);
      writes.push(body);
      prefs = { ...prefs, ...body.prefs };
    }
    return new Response(JSON.stringify({ prefs }));
  });
  const view = await harness();
  try {
    assert.deepEqual(view.state.current!.hiddenIds, ['personal']);
    await act(async () => { await view.state.current!.setVisible('team', false); });
    assert.deepEqual(view.state.current!.hiddenIds, ['personal', 'team']);
    assert.deepEqual(writes, [{ prefs: { hiddenTaskWorkspaceIds: ['personal', 'team'] } }]);
    assert.equal(prefs.sidebarWidth, 280);
  } finally { await view.close(); }
  const reopened = await harness();
  try {
    assert.deepEqual(reopened.state.current!.hiddenIds, ['personal', 'team']);
    await act(async () => { await reopened.state.current!.setVisible('personal', true); });
    assert.deepEqual(reopened.state.current!.hiddenIds, ['team']);
    await act(async () => { await reopened.state.current!.showAll(); });
    assert.deepEqual(reopened.state.current!.hiddenIds, []);
    assert.deepEqual(prefs.hiddenTaskWorkspaceIds, []);
  } finally { await reopened.close(); }
});

test('failed load can retry; hidden workspaces stay unresolved until preferences arrive', async t => {
  let fail = true;
  let resolve!: (response: Response) => void;
  t.mock.method(globalThis, 'fetch', async () => {
    if (fail) throw new TypeError('offline');
    return new Promise<Response>(done => { resolve = done; });
  });
  const view = await harness();
  try {
    assert.equal(view.state.current!.error, true);
    assert.equal(view.state.current!.hiddenIds, null);
    fail = false;
    await act(async () => { view.state.current!.retry(); });
    assert.equal(view.state.current!.error, false);
    assert.equal(view.state.current!.hiddenIds, null);
    await act(async () => { resolve(new Response(JSON.stringify({ prefs: { hiddenTaskWorkspaceIds: ['personal'] } }))); });
    assert.deepEqual(view.state.current!.hiddenIds, ['personal']);
  } finally { await view.close(); }
});

test('hide is immediate, overlapping writes are blocked, failed save rolls visibility back', async t => {
  let reject!: (error: Error) => void;
  let writes = 0;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    if (init.method === 'PUT') {
      writes += 1;
      return new Promise<Response>((_done, fail) => { reject = fail; });
    }
    return new Response(JSON.stringify({ prefs: {} }));
  });
  const view = await harness();
  try {
    let pending!: Promise<void>;
    await act(async () => { pending = view.state.current!.setVisible('personal', false); });
    assert.equal(view.state.current!.saving, true);
    assert.deepEqual(view.state.current!.hiddenIds, ['personal']);
    await act(async () => { await view.state.current!.setVisible('team', false); });
    assert.equal(writes, 1);
    await act(async () => { reject(new TypeError('offline')); await pending; });
    assert.deepEqual(view.state.current!.hiddenIds, []);
    assert.equal(view.state.current!.saving, false);
  } finally { await view.close(); }
});
