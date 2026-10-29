import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { AdminRepository, AdminUser } from '@/application/admin/AdminRepository';

const { createRoot } = await import('react-dom/client');

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
const scope = globalThis as typeof globalThis & { __adminUsers: { repository: Partial<AdminRepository> } };
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('./AdminUserDialogs.tsx', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
  tsconfig: fileURLToPath(new URL('../../../../tsconfig.app.json', import.meta.url)),
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  plugins: [{ name: 'admin-user-ports', setup(bundler) {
    bundler.onResolve({ filter: /(^@\/infrastructure\/di\/container$|MotionProvider$|^@\/components\/ui\/sonner$)/ }, (args) => ({ path: args.path, namespace: 'admin-test' }));
    bundler.onLoad({ filter: /.*/, namespace: 'admin-test' }, (args) => ({ loader: 'js', contents:
      args.path.endsWith('container') ? 'export const useContainer=()=>({adminRepository:globalThis.__adminUsers.repository});'
        : args.path.endsWith('MotionProvider') ? 'export const useMotion=()=>({animations:false});'
          : 'export const toast={success:()=>{}};',
    }));
  } }],
});
const loaded = { exports: {} as Record<string, React.ComponentType<{ user: AdminUser; onClose: () => void; onSaved: () => void }>> };
new Function('module', 'exports', 'require', compiled.outputFiles[0]!.text)(loaded, loaded.exports, createRequire(import.meta.url));
const user: AdminUser = { id: 'target', displayName: 'Иван', email: 'ivan@example.test', avatarUrl: '/avatar.png',
  isAdmin: false, projectCount: 3, ownedProjectCount: 1, delegationEnabledCount: 0, githubConnected: false,
  plan: 'prime', subscriptionExpiresAt: '2026-12-01T10:20:35.000Z' };

async function harness(component: string, repository: Partial<AdminRepository>, override: Partial<AdminUser> = {}) {
  scope.__adminUsers = { repository };
  let saved = 0;
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(loaded.exports[component]!, { user: { ...user, ...override },
    onClose: () => {}, onSaved: () => { saved++; } })));
  const field = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!;
  const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!;
  return { field, button, get saved() { return saved; },
    fill: (id: string, value: string) => act(async () => {
      const input = field(id);
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }),
    click: (element: HTMLElement) => act(async () => element.click()),
    submit: () => act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }),
    close: async () => { await act(async () => root.unmount()); host.remove(); },
  };
}

test('delete requires the exact confirmation email, disables pending submissions and keeps errors visible', async () => {
  let calls = 0;
  let fail!: (reason: Error) => void;
  const view = await harness('DeleteUserDialog', { deleteUser: async (id) => {
    assert.equal(id, user.id); calls++;
    return new Promise<void>((_resolve, reject) => { fail = reject; });
  } });
  try {
    assert.equal(view.button('Удалить пользователя').disabled, true);
    await view.fill('admin-delete-email', 'another@example.test'); await view.submit();
    assert.equal(calls, 0);
    await view.fill('admin-delete-email', 'IVAN@example.test'); await view.submit();
    assert.equal(calls, 1); assert.equal(view.field('admin-delete-email').disabled, true);
    await view.submit(); assert.equal(calls, 1);
    await act(async () => fail(new Error('Пользователь уже удалён')));
    assert.match(document.querySelector('[role=alert]')!.textContent!, /уже удалён/);
    assert.equal(view.field('admin-delete-email').value, 'IVAN@example.test');
    assert.equal(view.saved, 0);
  } finally { await view.close(); }
});

test('profile editing validates, normalizes fields, removes avatar and reports email conflicts without closing', async () => {
  const patches: unknown[] = [];
  let conflict = true;
  const view = await harness('EditUserDialog', { updateUser: async (_id, patch) => {
    patches.push(patch); if (conflict) throw new Error('Эта почта уже используется');
  } });
  try {
    await view.fill('admin-edit-name', '  '); await view.submit(); assert.equal(patches.length, 0);
    await view.fill('admin-edit-name', '  Новое имя  ');
    await view.fill('admin-edit-email', ' NEW@Example.Test ');
    await view.click(document.querySelector<HTMLElement>('#admin-remove-avatar')!); await view.submit();
    assert.equal(view.saved, 0);
    assert.match(document.querySelector('[role=alert]')!.textContent!, /почта уже используется/);
    conflict = false; await view.submit();
    assert.equal(view.saved, 1);
    assert.deepEqual(patches[1], { displayName: 'Новое имя', email: 'new@example.test', avatarUrl: null });
  } finally { await view.close(); }
});

test('same-plan expiry is editable, original seconds survive unchanged saves, and unlimited/free send null', async () => {
  const grants: unknown[][] = [];
  const view = await harness('UserPlanDialog', { setUserPlan: async (...args) => { grants.push(args); } });
  try {
    await view.submit(); assert.deepEqual(grants[0], [user.id, 'prime', user.subscriptionExpiresAt]);
    await view.fill('admin-plan-expiry', '2027-02-15T14:30'); await view.submit();
    assert.deepEqual(grants[1], [user.id, 'prime', new Date('2027-02-15T14:30').toISOString()]);
    await view.click(document.querySelector<HTMLElement>('#admin-plan-unlimited')!); await view.submit();
    assert.deepEqual(grants[2], [user.id, 'prime', null]);
    assert.equal(view.field('admin-plan-expiry').disabled, true);
    await view.click(document.querySelector<HTMLElement>('[role=tab]')!); await view.submit();
    assert.deepEqual(grants[3], [user.id, 'free', null]);
  } finally { await view.close(); }
});
