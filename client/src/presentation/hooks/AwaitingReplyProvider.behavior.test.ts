import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { AwaitingReplyTask } from '@/domain/task/AwaitingReplyTask';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test('a late pre-acceptance response cannot restore the reply badge; a new question still appears', async () => {
  const pending: Array<(tasks: AwaitingReplyTask[]) => void> = [];
  (globalThis as typeof globalThis & { __replyTest: unknown }).__replyTest = {
    taskAssigneeRepository: { listAwaitingReply: () => new Promise(resolve => pending.push(resolve)) },
  };
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./AwaitingReplyProvider.tsx', import.meta.url))], bundle: true, write: false,
    platform: 'node', format: 'cjs', jsx: 'automatic',
    tsconfig: fileURLToPath(new URL('../../../tsconfig.app.json', import.meta.url)), external: ['react', 'react/jsx-runtime'],
    plugins: [{ name: 'reply-ports', setup(bundler) {
      const ports: Record<string, string> = {
        '@/infrastructure/di/container': 'export const useContainer=()=>globalThis.__replyTest;',
        'react-router-dom': 'export const useLocation=()=>({pathname:"/"});',
        '@/presentation/hooks/useNotificationStream': 'export const TASK_CHANGED_EVENT="pf:task-changed",REALTIME_CONNECTED_EVENT="pf:realtime-connected",NOTIFICATIONS_CHANGED_EVENT="pf:notifications-changed";',
      };
      bundler.onResolve({ filter: /.*/ }, args => ports[args.path] ? { path: args.path, namespace: 'reply-ports' } : undefined);
      bundler.onLoad({ filter: /.*/, namespace: 'reply-ports' }, args => ({ loader: 'js', contents: ports[args.path] }));
    } }],
  });
  type State = { refresh(): void; questionFor(id: string): unknown };
  const module = { exports: {} as { AwaitingReplyProvider: React.ComponentType<React.PropsWithChildren>; useAwaitingReply(): State } };
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
  let state!: State;
  function Probe() { state = module.exports.useAwaitingReply(); return null; }
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const question = { id: 'task', question: { commentId: 'new-question' } } as AwaitingReplyTask;
  try {
    await act(async () => root.render(React.createElement(module.exports.AwaitingReplyProvider, null, React.createElement(Probe))));
    await act(async () => state.refresh());
    await act(async () => pending[1]!([]));
    await act(async () => pending[0]!([question]));
    assert.equal(state.questionFor('task'), null);
    await act(async () => state.refresh());
    await act(async () => pending[2]!([question]));
    assert.deepEqual(state.questionFor('task'), question.question);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
