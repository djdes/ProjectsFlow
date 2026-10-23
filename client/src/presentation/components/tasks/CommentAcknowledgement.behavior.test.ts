import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { TaskComment } from '@/domain/task/TaskComment';
import type { TaskRepository } from '@/application/task/TaskRepository';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = { user: { id: 'me' }, container: { taskRepository: {} as TaskRepository }, refreshes: 0, errors: 0 };
(globalThis as typeof globalThis & { __ackTest: typeof state }).__ackTest = state;

async function component() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./CommentAcknowledgement.tsx', import.meta.url))], bundle: true, write: false,
    platform: 'node', format: 'cjs', jsx: 'automatic',
    tsconfig: fileURLToPath(new URL('../../../../tsconfig.app.json', import.meta.url)),
    external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/*'],
    plugins: [{ name: 'ports', setup(bundler) {
      const ports: Record<string, string> = {
        '@/infrastructure/di/container': 'export const useContainer=()=>globalThis.__ackTest.container;',
        '@/presentation/hooks/useCurrentUser': 'export const useCurrentUser=()=>({user:globalThis.__ackTest.user});',
        '@/presentation/hooks/AwaitingReplyProvider': 'export const useAwaitingReply=()=>({refresh:()=>globalThis.__ackTest.refreshes++});',
        '@/components/ui/sonner': 'export const toast={error:()=>globalThis.__ackTest.errors++};',
      };
      bundler.onResolve({ filter: /.*/ }, args => ports[args.path] ? { path: args.path, namespace: 'ports' } : undefined);
      bundler.onLoad({ filter: /.*/, namespace: 'ports' }, args => ({ contents: ports[args.path], loader: 'js' }));
    } }],
  });
  const module = { exports: {} as { CommentAcknowledgement: React.ComponentType<{ projectId: string; comment: TaskComment }> } };
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
  return module.exports.CommentAcknowledgement;
}

test('acceptance uses the repository port, shows saving, blocks double click and refreshes reply badges only on success', async () => {
  const View = await component();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let respond!: (value: NonNullable<TaskComment['acknowledgements']>) => void;
  let reject!: (error: Error) => void;
  const requests: unknown[][] = [];
  state.container.taskRepository = { setCommentAcknowledged: async (...args: unknown[]) => {
    requests.push(args);
    return new Promise((resolve, fail) => { respond = resolve; reject = fail; });
  } } as unknown as TaskRepository;
  const ack = { commentId: 'c', userId: 'me', displayName: 'Денис', acknowledgedAt: new Date('2026-10-23T10:00:00Z') };
  const comment = { id: 'c', taskId: 't', ownerUserId: 'other', actorKind: 'user', acknowledgements: [] } as unknown as TaskComment;
  try {
    await act(async () => root.render(React.createElement(View, { projectId: 'p', comment })));
    const button = () => host.querySelector('button')!;
    await act(async () => { button().click(); button().click(); });
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], ['p', 't', 'c', true]);
    assert.equal(button().disabled, true);
    assert.match(host.textContent!, /Сохраняю/);
    await act(async () => respond([ack]));
    assert.equal(button().getAttribute('aria-pressed'), 'true');
    assert.match(host.textContent!, /Приняли: вы/);
    assert.equal(state.refreshes, 1);
    await act(async () => button().click());
    assert.deepEqual(requests[1], ['p', 't', 'c', false]);
    await act(async () => reject(new Error('Connection failed')));
    assert.equal(button().getAttribute('aria-pressed'), 'true');
    assert.equal(state.errors, 1);
    assert.equal(state.refreshes, 1);
    await act(async () => button().click());
    await act(async () => respond([]));
    assert.equal(button().getAttribute('aria-pressed'), 'false');
    assert.equal(state.refreshes, 2);
    // Another participant's acceptance arrives through the parent refresh.
    await act(async () => root.render(React.createElement(View, { projectId: 'p', comment: { ...comment,
      acknowledgements: [{ ...ack, userId: 'colleague', displayName: 'Мария', acknowledgedAt: new Date(ack.acknowledgedAt) }] } })));
    assert.match(host.textContent!, /Приняли: Мария/);
    // Author sees confirmations, but cannot accept their own comment in the UI.
    await act(async () => root.render(React.createElement(View, { projectId: 'p', comment: { ...comment, ownerUserId: 'me',
      acknowledgements: [{ ...ack, userId: 'colleague', displayName: 'Мария', acknowledgedAt: new Date(ack.acknowledgedAt) }] } })));
    assert.equal(host.querySelector('button'), null);
    assert.match(host.textContent!, /Мария/);
    await act(async () => root.render(React.createElement(View, { projectId: 'p', comment: { ...comment, body: 'Изменённый текст' } })));
    assert.doesNotMatch(host.textContent!, /Приняли:/);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
