import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ContainerProvider } from '@/infrastructure/di/container';
import type { Task } from '@/domain/task/Task';
import { CancelWorkButton } from './CancelWorkButton';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('revoke applies the response without a parent refetch, errors retain pending, fresh props win', async () => {
  const source = {
    id: 'task', projectId: 'project', status: 'in_progress',
    assignee: { userId: 'user', displayName: 'Пользователь', avatarUrl: null },
    createdAt: new Date(0), updatedAt: new Date(0),
    ralphCancelRequestedAt: new Date(), ralphCancelRequestedBy: 'user',
    ralphCancelRequestedByDisplayName: 'Пользователь',
  } as Task;
  const originalFetch = globalThis.fetch;
  let fail = true;
  let changes = 0;
  globalThis.fetch = async (_url, init) => {
    assert.equal(init?.method, 'DELETE');
    return new Response(JSON.stringify(fail ? { error: 'failure' } : {
      task: { ...source, ralphCancelRequestedAt: null, ralphCancelRequestedBy: null,
        ralphCancelRequestedByDisplayName: null },
    }), { status: fail ? 500 : 200, headers: { 'Content-Type': 'application/json' } });
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const render = async (task: Task) => act(async () => {
    root.render(React.createElement(ContainerProvider, null,
      React.createElement(CancelWorkButton, { task, onChanged: () => { changes++; } })));
  });
  const click = async () => act(async () => {
    host.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  try {
    await render(source);
    await click();
    assert.match(host.textContent!, /Отозвать запрос/);
    assert.equal(changes, 0);
    fail = false;
    await click();
    assert.doesNotMatch(host.textContent!, /Отмена запрошена/);
    assert.match(host.textContent!, /Отменить работу/);
    assert.equal(changes, 1);
    await render(source); // The parent still has the original task.
    assert.doesNotMatch(host.textContent!, /Отозвать запрос/);
    await render({ ...source, updatedAt: new Date() }); // A new request from SSE.
    assert.match(host.textContent!, /Отозвать запрос/);
  } finally {
    globalThis.fetch = originalFetch;
    await act(async () => root.unmount());
    host.remove();
  }
});
