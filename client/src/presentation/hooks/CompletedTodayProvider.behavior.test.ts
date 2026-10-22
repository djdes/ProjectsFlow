import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test('worker completion updates the pill; retries and out-of-order snapshots cannot inflate it', async () => {
  let serverCount = 1, reads = 0;
  let deferred: Array<(value: number) => void> | null = null;
  const scope = globalThis as typeof globalThis & { __completionTest: unknown };
  scope.__completionTest = { statsRepository: { completedToday() {
    reads++;
    return deferred ? new Promise<number>(resolve => deferred!.push(resolve)) : Promise.resolve(serverCount);
  } } };
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./CompletedTodayProvider.tsx', import.meta.url))], bundle: true, write: false,
    platform: 'node', format: 'cjs', jsx: 'automatic',
    tsconfig: fileURLToPath(new URL('../../../tsconfig.app.json', import.meta.url)),
    external: ['react', 'react/jsx-runtime'],
    plugins: [{ name: 'stats-port', setup(bundler) {
      bundler.onResolve({ filter: /^(@\/infrastructure\/di\/container|\.\/useNotificationStream)$/ }, args => ({ path: args.path, namespace: 'stats-test' }));
      bundler.onLoad({ filter: /.*/, namespace: 'stats-test' }, args => ({ loader: 'js', contents: args.path.startsWith('@')
        ? 'export const useContainer=()=>globalThis.__completionTest;'
        : 'export const TASK_CHANGED_EVENT="pf:task-changed",LIVE_CHANGED_EVENT="pf:live-changed",REALTIME_CONNECTED_EVENT="pf:realtime-connected";' }));
    } }],
  });
  type State = { count: number | null; celebrationKey: number; celebrate(id: string): void; forget(id: string): void };
  const module = { exports: {} as { CompletedTodayProvider: React.ComponentType<React.PropsWithChildren>; useCompletedToday(): State } };
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
  let state!: State;
  function Probe() { state = module.exports.useCompletedToday(); return React.createElement('span', null, String(state.count)); }
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const event = async (name: string) => { await act(async () => { window.dispatchEvent(new Event(name)); }); };
  try {
    await act(async () => { root.render(React.createElement(module.exports.CompletedTodayProvider, null, React.createElement(Probe))); });
    assert.equal(state.count, 1);
    serverCount = 4; await event('pf:live-changed'); assert.equal(state.count, 4, 'completed worker tasks appear without reopening the tab');
    serverCount = 3; await event('pf:task-changed'); assert.equal(state.count, 3, 'returning work removes its credit');
    serverCount = 5; await event('pf:realtime-connected'); assert.equal(state.count, 5);
    await act(async () => { state.celebrate('already-counted'); });
    assert.equal(state.count, 5, 'a realtime snapshot followed by a completion callback cannot double-count');
    assert.equal(state.celebrationKey, 1);
    await act(async () => { state.celebrate('already-counted'); });
    assert.equal(state.celebrationKey, 1);
    deferred = [];
    await event('pf:live-changed'); await event('pf:task-changed');
    const pending = deferred; deferred = null;
    await act(async () => { pending![1](7); });
    await act(async () => { pending![0](2); });
    assert.equal(state.count, 7, 'an older HTTP response cannot overwrite the new count');
    serverCount = 6; await act(async () => { state.forget('already-counted'); }); assert.equal(state.count, 6);
    serverCount = 8; await event('focus'); assert.equal(state.count, 8);
  } finally {
    await act(async () => { root.unmount(); }); host.remove();
  }
  const before = reads; await event('pf:live-changed'); assert.equal(reads, before, 'subscriptions are removed on unmount');
});
