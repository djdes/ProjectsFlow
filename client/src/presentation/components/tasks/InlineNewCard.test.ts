import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import type { Task } from '@/domain/task/Task';

// React's input-event detection must run after the DOM is installed.
const { createRoot } = await import('react-dom/client');
const { InlineNewCard } = await import('./KanbanColumn');

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

async function harness(onCreate: (name: string) => Promise<Task | null>) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let closed = 0;
  await act(async () => {
    root.render(React.createElement(InlineNewCard, {
      onCreate, onClose: () => { closed += 1; }, onOpenFull: () => {},
    }));
  });
  const field = host.querySelector('textarea')!;
  return {
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

test('inline creation preserves the draft when saving on blur fails', async () => {
  let calls = 0;
  const view = await harness(async () => { calls += 1; throw new Error('offline'); });
  try {
    await view.fill('Сохранить этот черновик');
    await view.blur();
    assert.equal(calls, 1);
    assert.equal(view.closed, 0);
    assert.equal(view.field.value, 'Сохранить этот черновик');
    assert.equal(view.field.readOnly, false);
  } finally { await view.close(); }
});

test('a pending Enter save and blur cannot duplicate or close the draft', async () => {
  let finish!: (task: Task) => void;
  let calls = 0;
  const pending = new Promise<Task>((resolve) => { finish = resolve; });
  const view = await harness(async (name) => { calls += 1; assert.equal(name, 'Новая задача'); return pending; });
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
