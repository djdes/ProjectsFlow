import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useExitingListItems } from './useExitingListItems';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Item = { id: string; title: string };
for (const changeScope of [false, true]) {
  test(`animated lists never render stale live content${changeScope ? ' or another person ghosts' : ' before effects'}`, async () => {
    const snapshots: string[][] = [];
    function Probe({ items, scope }: { items: Item[]; scope: string }) {
      const visible = useExitingListItems(items, (item) => item.id, 300, scope);
      snapshots.push(visible.map(({ item }) => item.title));
      return createElement('div', null, visible.map(({ item }) => createElement('span', { key: item.id }, item.title)));
    }
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(Probe, { items: [{ id: 'project', title: 'Old person task' }], scope: 'first' })));
      snapshots.length = 0;
      await act(async () => root.render(createElement(Probe, {
        items: [{ id: changeScope ? 'another-project' : 'project', title: 'Current person task' }],
        scope: changeScope ? 'second' : 'first',
      })));
      assert.ok(snapshots.length > 0);
      for (const snapshot of snapshots) assert.deepEqual(snapshot, ['Current person task']);
    } finally { await act(async () => root.unmount()); }
  });
}
