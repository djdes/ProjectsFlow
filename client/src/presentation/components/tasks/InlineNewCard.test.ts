import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act } from 'react';
import type { Task } from '@/domain/task/Task';
import type { User } from '@/domain/user/User';

// React's input-event detection must run after the DOM is installed.
const { createRoot } = await import('react-dom/client');
const { InlineNewCard } = await import('./InlineNewCard');
const { ContainerProvider, useContainer } = await import('@/infrastructure/di/container');
const { AuthProvider } = await import('@/presentation/auth/AuthProvider');

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

async function harness(t: TestContext, onCreate: (name: string) => Promise<Task | null>) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let closed = 0;
  function Prepare(): React.ReactElement {
    const c = useContainer();
    const once = React.useRef(false);
    if (!once.current) {
      once.current = true;
      t.mock.method(c.authRepository, 'getCurrentOrNull', async () => ({ id: 'me', displayName: 'Автор', email: 'me@example.test' } as User));
      t.mock.method(c.projectRepository, 'listSharedMembers', async () => []);
    }
    return React.createElement(AuthProvider, null, React.createElement(InlineNewCard, {
      defaults: { assigneeUserId: 'me' },
      onCreate, onClose: () => { closed += 1; }, onOpenFull: () => {},
    }));
  }
  await act(async () => {
    root.render(React.createElement(ContainerProvider, null, React.createElement(Prepare)));
  });
  const field = host.querySelector('textarea')!;
  return {
    host,
    field,
    get closed() { return closed; },
    async fill(text: string) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(field, text);
        field.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
    },
    async blur() {
      await act(async () => {
        field.blur();
        await new Promise((r) => setTimeout(r, 10));
      });
    },
    async close() {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

test('inline creation preserves the draft when saving on blur fails', async (t) => {
  let calls = 0;
  const view = await harness(t, async () => { calls += 1; throw new Error('offline'); });
  try {
    await view.fill('Сохранить этот черновик');
    await view.blur();
    assert.equal(calls, 1);
    assert.equal(view.closed, 0);
    assert.equal(view.field.value, 'Сохранить этот черновик');
    assert.equal(view.field.readOnly, false);
  } finally { await view.close(); }
});

test('a pending Enter save and blur cannot duplicate or close the draft', async (t) => {
  let finish!: (task: Task) => void;
  let calls = 0;
  const pending = new Promise<Task>((resolve) => { finish = resolve; });
  const view = await harness(t, async (name) => { calls += 1; assert.equal(name, 'Новая задача'); return pending; });
  try {
    await act(async () => {
      view.field.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await view.blur();
    assert.equal(calls, 1);
    assert.equal(view.closed, 0);
    assert.equal(view.field.readOnly, true);
    await act(async () => finish({ id: 'saved', status: 'backlog' } as Task));
    assert.equal(view.field.value, '');
    assert.equal(view.field.readOnly, false);
    assert.equal(view.closed, 0);
  } finally { await view.close(); }
});

test('leaving the native date control never submits the draft', async (t) => {
  let calls = 0;
  const view = await harness(t, async () => { calls += 1; return { id: 'saved' } as Task; });
  try {
    await view.fill('Выбрать дату перед сохранением');
    const date = view.host.querySelector<HTMLInputElement>('input[type="date"]')!;
    await act(async () => { date.focus(); await new Promise((resolve) => setTimeout(resolve, 10)); });
    await act(async () => { date.blur(); await new Promise((resolve) => setTimeout(resolve, 10)); });
    assert.equal(calls, 0);
    assert.equal(view.closed, 0);
    assert.equal(view.field.value, 'Выбрать дату перед сохранением');
  } finally { await view.close(); }
});
