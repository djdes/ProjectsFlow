import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ContainerProvider } from '@/infrastructure/di/container';
import { AuthProvider, useAuth } from './AuthProvider';
import { MemoryRouter } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
// The repository's tsx test runner uses classic JSX for imported TSX modules.
Object.assign(globalThis, { React });

const user = { id: 'u1', email: 'test@example.invalid', displayName: 'Test', avatarUrl: null, createdAt: '2026-01-01' };
async function harness() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const state = { current: null as ReturnType<typeof useAuth> | null };
  function Probe() {
    state.current = useAuth();
    return React.createElement(MemoryRouter, null,
      React.createElement(ProtectedRoute, null, React.createElement('div', { id: 'allowed-content' }, 'Доступ открыт')));
  }
  await act(async () => { root.render(React.createElement(ContainerProvider, null, React.createElement(AuthProvider, null, React.createElement(Probe)))); });
  return { state, host, async close() { await act(async () => root.unmount()); host.remove(); } };
}
test('a network failure keeps access blocked and can recover without signing in again', async (t) => {
  t.mock.method(console, 'error', () => {});
  let online = false;
  t.mock.method(globalThis, 'fetch', async () => {
    if (!online) throw new TypeError('network offline');
    return new Response(JSON.stringify({ user }));
  });
  const view = await harness();
  try {
    assert.equal(view.state.current!.status, 'unavailable');
    assert.equal(view.state.current!.user, null);
    assert.equal(view.host.querySelector('#allowed-content'), null);
    assert.match(view.host.textContent!, /Проверьте интернет/);
    online = true;
    await act(async () => { window.dispatchEvent(new Event('online')); });
    assert.equal(view.state.current!.status, 'authenticated');
    assert.equal(view.state.current!.user!.id, 'u1');
    assert.ok(view.host.querySelector('#allowed-content'));
  } finally { await view.close(); }
});
test('a stale anonymous probe cannot undo a successful login', async (t) => {
  let finishProbe!: (response: Response) => void;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (init.method === 'GET') return new Promise<Response>((resolve) => { finishProbe = resolve; });
    return new Response(JSON.stringify({ user }));
  });
  const view = await harness();
  try {
    await act(async () => { await view.state.current!.login({ email: user.email, password: 'test' }); });
    await act(async () => { finishProbe(new Response('{"error":"unauthorized"}', { status: 401 })); });
    assert.equal(view.state.current!.status, 'authenticated');
    assert.equal(view.state.current!.user!.id, 'u1');
  } finally { await view.close(); }
});
