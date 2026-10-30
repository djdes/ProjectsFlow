import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import type { Workspace } from '@/domain/workspace/Workspace';
// Radix selects its DOM layout effects at module evaluation time.
const { createRoot } = await import('react-dom/client');
const { TaskWorkspaceVisibilityMenu } = await import('./TaskWorkspaceVisibilityMenu');
Object.assign(globalThis, { React });

const workspaces = [
  { id: 'personal', name: 'Личное', icon: null },
  { id: 'team', name: 'SUB Сайты/Скрипты', icon: '☀️' },
] as Workspace[];

test('menu identifies hidden spaces and allows restoring one or all when every board is hidden', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const changes: [string, boolean][] = [];
  let showAll = 0;
  try {
    await act(async () => {
      root.render(React.createElement(TaskWorkspaceVisibilityMenu, {
        workspaces, hiddenIds: ['personal', 'team'], saving: false,
        onVisibleChange: (id, visible) => { changes.push([id, visible]); },
        onShowAll: () => { showAll += 1; },
      }));
    });
    const trigger = host.querySelector('button')!;
    assert.match(trigger.textContent!, /Пространства 0\/2/);
    const open = async () => {
      await act(async () => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    };
    await open();
    const options = document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]');
    assert.equal(options.length, 2);
    assert.equal(options[0].getAttribute('aria-checked'), 'false');
    assert.match(options[0].textContent!, /Личное/);
    await act(async () => { options[0].click(); });
    assert.deepEqual(changes, [['personal', true]]);
    await open();
    const restore = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === 'Показать все');
    assert.ok(restore);
    await act(async () => { restore.click(); });
    assert.equal(showAll, 1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
