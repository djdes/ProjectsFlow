import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register({ width: 390, height: 844 });
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act, useRef, useState } from 'react';
import type { Task } from '@/domain/task/Task';
import type { Project } from '@/domain/project/Project';
import type { User } from '@/domain/user/User';
import type { Workspace } from '@/domain/workspace/Workspace';
import type { UiPrefs } from '@/domain/user/UiPrefs';
import { TASK_PROPERTY_KEYS } from '@/domain/user/UiPrefs';
import { Flag } from 'lucide-react';

const { createRoot } = await import('react-dom/client');
const { ContainerProvider, useContainer } = await import('@/infrastructure/di/container');
const { AuthProvider } = await import('@/presentation/auth/AuthProvider');
const { WorkspacesProvider } = await import('@/presentation/hooks/WorkspacesProvider');
const { MotionProvider } = await import('@/presentation/components/motion/MotionProvider');
const { TaskStatusField } = await import('./TaskStatusField');
const { TaskProjectField } = await import('./TaskProjectField');
const { TaskApproverRow } = await import('./TaskApproverRow');
const { TaskProperties } = await import('./TaskProperties');
Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const task = { id: 'task', projectId: 'inbox', status: 'backlog', updatedAt: new Date(), assignee: { userId: 'me' } } as Task;
const inbox = { id: 'inbox', ownerId: 'me', isInbox: true, role: 'owner', status: 'active', workspaceId: 'ws', name: 'Личное' } as Project;
const destination = { ...inbox, id: 'project', isInbox: false, name: 'Проект команды' };
const workspace = { id: 'ws', isCurrent: true, workerEnabled: false, requireTaskApproval: true } as Workspace;

async function mount(t: TestContext, element: React.ReactElement, options: {
  move?: (status: string) => Promise<Task>;
  transfer?: () => Promise<Task>;
  prefs?: UiPrefs;
  savePrefs?: (prefs: UiPrefs) => Promise<UiPrefs>;
} = {}) {
  // Pin the mobile branch; Happy DOM does not lay out a real viewport.
  t.mock.method(window, 'matchMedia', (query: string) => ({
    matches: query.includes('max-width') || query.includes('prefers-reduced-motion'), media: query,
    onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true,
  }));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  function Dependencies() {
    const c = useContainer();
    const patched = useRef(false);
    if (!patched.current) {
      patched.current = true;
      t.mock.method(c.authRepository, 'getCurrentOrNull', async () => ({ id: 'me' } as User));
      t.mock.method(c.listWorkspaces, 'execute', async () => [workspace]);
      t.mock.method(c.projectRepository, 'getById', async (id: string) => id === 'inbox' ? inbox : destination);
      t.mock.method(c.projectRepository, 'getKanbanSettings', async () => ({}));
      t.mock.method(c.projectRepository, 'list', async () => [destination, { ...destination, id: 'viewer', role: 'viewer', name: 'Только просмотр' }]);
      t.mock.method(c.projectRepository, 'getInbox', async () => inbox);
      t.mock.method(c.workspaceRepository, 'listMembers', async () => [
        { userId: 'lead', role: 'lead', displayName: 'Александра Руководитель', avatarUrl: null },
        { userId: 'owner', role: 'owner', displayName: 'Иван Владелец', avatarUrl: null },
        { userId: 'editor', role: 'editor', displayName: 'Другой участник', avatarUrl: null },
      ]);
      t.mock.method(c.taskRepository, 'move', async (_project: string, _id: string, input: { targetStatus: string }) => options.move?.(input.targetStatus) ?? task);
      t.mock.method(c.taskRepository, 'assignToProject', async () => options.transfer?.() ?? { ...task, projectId: 'project' });
      t.mock.method(c.userRepository, 'getUiPrefs', async () => options.prefs ?? {});
      t.mock.method(c.userRepository, 'setUiPrefs', async (prefs: UiPrefs) => options.savePrefs?.(prefs) ?? prefs);
    }
    return React.createElement(AuthProvider, null, React.createElement(WorkspacesProvider, null, React.createElement(MotionProvider, null, element)));
  }
  await act(async () => { root.render(React.createElement(ContainerProvider, null, React.createElement(Dependencies))); });
  return { host, close: async () => { await act(async () => root.unmount()); host.remove(); } };
}

async function click(element: Element | null) {
  assert.ok(element);
  await act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
}
async function openMenu(button: Element | null) {
  assert.ok(button);
  await act(async () => { button.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
}

test('status from Inbox saves pending text and shows the server approval result', async (t) => {
  const events: string[] = [];
  function Editor() {
    const [current, setCurrent] = useState(task);
    return React.createElement(TaskStatusField, { task: current, disabled: false, beforeChange: async () => { events.push('save text'); }, onChanged: setCurrent });
  }
  const view = await mount(t, React.createElement(Editor), { move: async (status) => {
    events.push(status);
    return { ...task, status: 'pending_approval' };
  } });
  try {
    await openMenu(view.host.querySelector('button'));
    const menu = document.querySelector('[role="menu"]');
    assert.equal(menu?.getAttribute('data-pf-mobile-sheet'), 'true');
    assert.ok(!menu?.textContent?.includes('Воркер'));
    await click([...document.querySelectorAll('[role="menuitemradio"]')].find((el) => el.textContent === 'Готово') ?? null);
    assert.deepEqual(events, ['save text', 'done']);
    assert.ok(view.host.textContent?.includes('На утверждении'));
  } finally { await view.close(); }
});

test('project transfer from personal tasks is available without an onMove callback', async (t) => {
  const events: string[] = [];
  const view = await mount(t, React.createElement(TaskProjectField, {
    task, isInbox: true, disabled: false, beforeChange: async () => { events.push('save text'); },
    onMoved: (moved) => { events.push(moved.projectId); },
  }), { transfer: async () => { events.push('transfer'); return { ...task, projectId: 'project' }; } });
  try {
    await click(view.host.querySelector('button'));
    const dialog = document.querySelector('[aria-label="Выбор проекта"]');
    assert.equal(dialog?.getAttribute('data-pf-mobile-sheet'), 'true');
    assert.ok(!dialog?.textContent?.includes('Только просмотр'));
    await click(dialog?.querySelector('[role="option"][aria-selected="false"]') ?? null);
    assert.deepEqual(events, ['save text', 'transfer', 'project']);
  } finally { await view.close(); }
});

test('failed text saving prevents project transfer and keeps the selector open', async (t) => {
  let transfers = 0;
  const view = await mount(t, React.createElement(TaskProjectField, {
    task, isInbox: true, disabled: false, beforeChange: async () => { throw new Error('offline'); }, onMoved: () => {},
  }), { transfer: async () => { transfers++; return task; } });
  try {
    await click(view.host.querySelector('button'));
    await click(document.querySelector('[role="option"][aria-selected="false"]'));
    assert.equal(transfers, 0);
    assert.ok(document.querySelector('[aria-label="Выбор проекта"]'));
  } finally { await view.close(); }
});

test('approver sheet exposes full names and roles, excluding ordinary editors', async (t) => {
  const view = await mount(t, React.createElement(TaskApproverRow, { projectId: 'project' }));
  try {
    await click(view.host.querySelector('button'));
    const content = document.querySelector('[role="dialog"]');
    assert.equal(content?.getAttribute('data-pf-mobile-sheet'), 'true');
    assert.ok(content?.textContent?.includes('Александра Руководитель'));
    assert.ok(content?.textContent?.includes('Иван Владелец'));
    assert.ok(!content?.textContent?.includes('Другой участник'));
  } finally { await view.close(); }
});

test('task properties restore the account order for another project and omit creation metadata', async (t) => {
  const items = Object.fromEntries(TASK_PROPERTY_KEYS.map((key) => [key, { icon: Flag, label: key, value: 'Значение' }])) as Parameters<typeof TaskProperties>[0]['items'];
  const view = await mount(t, React.createElement(TaskProperties, { taskId: 'another-project-task', items }), { prefs: { taskPropertyOrder: ['files', 'created', 'deadline', 'project'] } });
  try {
    const rows = [...view.host.querySelectorAll('[data-pf-task-property]')].map((row) => row.getAttribute('data-pf-task-property'));
    assert.deepEqual(rows.slice(0, 3), ['files', 'deadline', 'project']);
    assert.ok(!rows.includes('created'));
    assert.ok(rows.includes('status'));
  } finally { await view.close(); }
});

test('holding a property row reorders it and persists the full account layout', async (t) => {
  const items = Object.fromEntries(TASK_PROPERTY_KEYS.map((key) => [key, { icon: Flag, label: key, value: 'Значение' }])) as Parameters<typeof TaskProperties>[0]['items'];
  const writes: UiPrefs[] = [];
  const originalRect = window.HTMLElement.prototype.getBoundingClientRect;
  t.mock.method(window.HTMLElement.prototype, 'getBoundingClientRect', function (this: HTMLElement) {
    if (!this.hasAttribute('data-pf-task-property')) return originalRect.call(this);
    const index = [...this.parentElement!.children].indexOf(this);
    return new DOMRect(0, index * 44, 350, 44);
  });
  const view = await mount(t, React.createElement(TaskProperties, { taskId: 'task', items }), { savePrefs: async (prefs) => { writes.push(prefs); return prefs; } });
  const row = view.host.querySelector('[data-pf-task-property="status"]')!;
  const touch = (type: string, y: number) => {
    const event = new window.TouchEvent(type, { bubbles: true, cancelable: true });
    const point = { clientX: 100, clientY: y, identifier: 1, target: row };
    Object.defineProperties(event, { touches: { value: type === 'touchend' ? [] : [point] }, changedTouches: { value: [point] } });
    row.dispatchEvent(event);
  };
  try {
    await act(async () => { touch('touchstart', 22); await new Promise((resolve) => setTimeout(resolve, 350)); });
    await act(async () => { touch('touchmove', 112); });
    await act(async () => { touch('touchend', 112); });
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].taskPropertyOrder?.slice(0, 3), ['project', 'assignee', 'status']);
    assert.equal(view.host.querySelector('[data-pf-task-property]')?.getAttribute('data-pf-task-property'), 'project');
  } finally { await view.close(); }
});
