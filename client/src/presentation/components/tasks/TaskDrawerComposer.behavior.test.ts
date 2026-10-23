import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Editor } from '@tiptap/core';
import { ContainerProvider, useContainer } from '@/infrastructure/di/container';
import { AuthProvider, useAuth } from '@/presentation/auth/AuthProvider';
import { WorkspacesProvider } from '@/presentation/hooks/WorkspacesProvider';
import { MotionProvider } from '@/presentation/components/motion/MotionProvider';
import type { TaskRepository } from '@/application/task/TaskRepository';
import type { Task } from '@/domain/task/Task';
import type { User } from '@/domain/user/User';
import type { TaskComment } from '@/domain/task/TaskComment';
import { commentDraftKey, readCommentDraft } from './commentDraft';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
// Radix chooses its layout-effect implementation at import time, after the DOM exists.
const { TaskDrawerComposer } = await import('./TaskDrawerComposer');
const user: User = { id: 'author', email: 'author@example.invalid', displayName: 'Автор', avatarUrl: null, isAdmin: false };
function task(id: string, assignee = 'executor', status: Task['status'] = 'manual'): Task {
  return { id, projectId: 'project', status, assignee: { userId: assignee, displayName: assignee === 'executor' ? 'Исполнитель' : 'Автор', avatarUrl: null } } as Task;
}
function comment(id: string, body: string): TaskComment {
  return { id: 'created', taskId: id, body, attachments: [] } as unknown as TaskComment;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
type Props = React.ComponentProps<typeof TaskDrawerComposer>;
async function harness(initial: Task, options: { create?: TaskRepository['createComment']; move?: TaskRepository['move']; upload?: TaskRepository['uploadCommentAttachment']; privateTask?: boolean } = {}) {
  // Preload the real editor; no simplified editor mock hides persistence/formatting bugs.
  await import('@/presentation/components/editor/RichTextEditor');
  let restore: (() => void) | undefined;
  let auth!: ReturnType<typeof useAuth>;
  const created: TaskComment[] = [];
  const calls: Parameters<TaskRepository['createComment']>[] = [];
  let memberLoads = 0;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let props: Props | null = { task: initial, backlogTail: null, todoTail: null, onCommentCreated: (c) => created.push(c), onTaskChanged: () => {} };
  function Probe() {
    auth = useAuth();
    return props ? React.createElement(TaskDrawerComposer, props) : null;
  }
  function Providers() {
    const c = useContainer();
    if (!restore) {
      const originals = { auth: c.authRepository.getCurrentOrNull, members: c.projectRepository.listMembers, workspaces: c.listWorkspaces.execute, create: c.taskRepository.createComment, move: c.taskRepository.move, upload: c.taskRepository.uploadCommentAttachment };
      c.authRepository.getCurrentOrNull = async () => user;
      c.listWorkspaces.execute = async () => [];
      c.projectRepository.listMembers = async () => {
        memberLoads++;
        if (options.privateTask) throw new Error('forbidden');
        return ['author', 'executor', 'approver'].map((id) => ({ projectId: 'project', userId: id, role: 'editor' as const, joinedAt: new Date(), user: { id, displayName: id === 'executor' ? 'Исполнитель' : id, email: id + '@example.invalid', avatarUrl: null } }));
      };
      c.taskRepository.createComment = async (...args) => {
        calls.push(args);
        return options.create ? options.create(...args) : comment(args[1], args[2]);
      };
      c.taskRepository.move = options.move ?? (async () => initial);
      if (options.upload) c.taskRepository.uploadCommentAttachment = options.upload;
      restore = () => {
        c.authRepository.getCurrentOrNull = originals.auth;
        c.projectRepository.listMembers = originals.members;
        c.listWorkspaces.execute = originals.workspaces;
        c.taskRepository.createComment = originals.create;
        c.taskRepository.move = originals.move;
        c.taskRepository.uploadCommentAttachment = originals.upload;
      };
    }
    return React.createElement(AuthProvider, null, React.createElement(WorkspacesProvider, null, React.createElement(MotionProvider, null, React.createElement(Probe))));
  }
  async function draw() {
    await act(async () => root.render(React.createElement(ContainerProvider, null, React.createElement(Providers))));
    if (props) {
      for (let i = 0; i < 40 && !host.querySelector('.ProseMirror'); i++) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
      }
      assert.ok(host.querySelector('.ProseMirror'), 'real editor mounted');
    }
  }
  await draw();
  const editable = () => host.querySelector<HTMLElement>('.ProseMirror')!;
  const send = () => host.querySelector<HTMLButtonElement>('button[aria-label^="Отправить"]')!;
  const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label)!;
  const click = async (element: HTMLElement) => { assert.ok(element); await act(async () => { element.click(); }); };
  return {
    host, calls, created, editable, send, button, click,
    get memberLoads() { return memberLoads; },
    type: async (body: string) => { await act(async () => { (editable() as HTMLElement & { editor: Editor }).editor.commands.setContent(body, { contentType: 'markdown' }); }); },
    attach: async (file: File) => {
      const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    },
    render: async (next: Task | null, overrides: Partial<Props> = {}) => {
      props = next ? { task: next, backlogTail: null, todoTail: null, onCommentCreated: (c) => created.push(c), onTaskChanged: () => {}, ...overrides } : null;
      await draw();
    },
    user: async (next: User) => { await act(async () => auth.applyUserUpdate(next)); },
    close: async () => { await act(async () => root.unmount()); restore?.(); host.remove(); },
  };
}

test('closing and switching tasks restores rich text, quote and files only in their own draft', async () => {
  const a = task('restore-a');
  const b = task('restore-b');
  const view = await harness(a);
  try {
    await view.render(a, { replyDraft: { commentId: 'quoted', authorName: 'Коллега', quotedText: 'фрагмент' } });
    await view.type('**Черновик**\n\nВторая строка');
    await view.attach(new File(['data'], 'draft.txt'));
    await view.click(view.button('Никто'));
    await view.render(b);
    assert.equal(view.editable().textContent, '');
    assert.doesNotMatch(view.host.textContent!, /draft.txt|Коллега/);
    await view.type('Другой комментарий');
    await view.render(null);
    await view.render(a);
    assert.equal(view.editable().querySelector('strong')?.textContent, 'Черновик');
    assert.match(view.host.textContent!, /draft.txt/);
    assert.match(view.host.textContent!, /Коллега/);
    assert.equal(view.button('Никто').getAttribute('aria-pressed'), 'true');
    await view.user({ ...user, id: 'other-author' });
    assert.equal(view.editable().textContent, '');
    assert.doesNotMatch(view.host.textContent!, /draft.txt|Коллега/);
    await view.user(user);
    assert.match(view.editable().textContent!, /Черновик/);
    await view.render(b);
    assert.equal(view.editable().textContent, 'Другой комментарий');
  } finally { await view.close(); }
});

test('comments default to the assignee, manual silence survives refresh and re-enable selects the assignee', async () => {
  const a = task('audience');
  const view = await harness(a);
  try {
    assert.match(view.host.textContent!, /Исполнитель/);
    assert.equal(view.memberLoads, 1, 'audience control reuses loaded members');
    await view.type('Исполнителю');
    await view.click(view.send());
    assert.deepEqual(view.calls[0][3], { mode: 'selected', userIds: ['executor'] });
    assert.equal(view.editable().textContent, '');
    await view.click(view.button('Никто'));
    await view.render({ ...a, description: 'обновление с сервера' });
    await view.type('Без уведомления');
    await view.click(view.send());
    assert.deepEqual(view.calls[1][3], { mode: 'none' });
    await view.click(view.button('Уведомить'));
    await view.type('Снова исполнителю');
    await view.click(view.send());
    assert.deepEqual(view.calls[2][3], { mode: 'selected', userIds: ['executor'] });
  } finally { await view.close(); }
});

test('failed comment creation retains the draft for retry; successful send removes it', async () => {
  let fail = true;
  const a = task('retry');
  const view = await harness(a, { create: async (_project, id, body) => {
    if (fail) throw new Error('offline');
    return comment(id, body);
  } });
  try {
    await view.type('Не потерять');
    await view.click(view.send());
    assert.equal(view.editable().textContent, 'Не потерять');
    await view.render(null);
    await view.render(a);
    assert.equal(view.editable().textContent, 'Не потерять');
    fail = false;
    await view.click(view.send());
    assert.equal(view.created.length, 1);
    assert.equal(view.editable().textContent, '');
    assert.equal(window.localStorage.getItem(commentDraftKey('author', 'project', a.id)), null);
  } finally { await view.close(); }
});

test('switching during send cannot clear or append to another task and reopening cannot duplicate the send', async () => {
  const pending = deferred<TaskComment>();
  const a = task('inflight-a');
  const b = task('inflight-b');
  const view = await harness(a, { create: () => pending.promise });
  try {
    await view.type('Первый');
    await view.click(view.send());
    await view.render(null);
    await view.render(a);
    assert.equal(view.send().disabled, true);
    await view.click(view.send());
    assert.equal(view.calls.length, 1);
    await view.render(b);
    await view.type('Второй');
    await act(async () => { pending.resolve(comment(a.id, 'Первый')); await pending.promise; });
    assert.equal(view.editable().textContent, 'Второй');
    assert.equal(view.created.length, 0);
    await view.render(a);
    assert.equal(view.editable().textContent, '');
    assert.equal(view.send().disabled, true);
  } finally { await view.close(); }
});

test('move failure after comment creation clears sent text and preserves failed attachments', async () => {
  const a = task('move-fails', 'author', 'in_progress');
  const view = await harness(a, { move: async () => { throw new Error('move offline'); }, upload: async () => { throw new Error('upload offline'); } });
  try {
    await view.type('Отправленный комментарий');
    await view.attach(new File(['data'], 'retry.txt'));
    await view.click(view.send());
    assert.equal(view.created.length, 1);
    assert.equal(view.editable().textContent, '');
    assert.match(view.host.textContent!, /retry.txt/);
    assert.equal(readCommentDraft(commentDraftKey('author', 'project', a.id)).files.length, 1);
    await view.render(null);
    await view.render(a);
    assert.equal(view.editable().textContent, '');
    assert.match(view.host.textContent!, /retry.txt/);
    assert.deepEqual(view.calls[0][3], { mode: 'none' }, 'author is not notified about their own comment');
  } finally { await view.close(); }
});

test('task-only access never loads project members and still names the assignee', async () => {
  const a = { ...task('private'), context: { canReadProject: false } } as Task;
  const view = await harness(a, { privateTask: true });
  try {
    assert.equal(view.memberLoads, 0);
    assert.match(view.host.textContent!, /Исполнитель/);
    await view.type('По задаче');
    await view.click(view.send());
    assert.deepEqual(view.calls[0][3], { mode: 'selected', userIds: ['executor'] });
  } finally { await view.close(); }
});

test('read-only task allows discussion without offering worker controls or moving the task', async () => {
  let moves = 0;
  const view = await harness({ ...task('read-only-task', 'author', 'awaiting_clarification'), canEdit: false }, {
    move: async () => { moves++; return task('read-only-task'); },
  });
  try {
    assert.doesNotMatch(view.host.textContent!, /Воркеру/);
    await view.type('Комментарий без управления задачей');
    await view.click(view.send());
    assert.equal(view.created.length, 1);
    assert.equal(moves, 0);
  } finally { await view.close(); }
});


test('deselecting the last recipient silences notifications and self-assignees can choose another recipient', async () => {
  const a = task('recipient-menu');
  const view = await harness(a);
  try {
    const trigger = () => view.host.querySelector<HTMLButtonElement>('button[title="Кого уведомить"]')!;
    const openMenu = async () => {
      await act(async () => { trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    };
    const item = (name: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find((element) => element.querySelector('.truncate')?.textContent === name)!;
    await openMenu();
    assert.equal(item('Исполнитель').getAttribute('aria-checked'), 'true');
    await view.click(item('Исполнитель'));
    assert.equal(view.button('Никто').getAttribute('aria-pressed'), 'true');
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await view.render(task('self-recipient-menu', 'author'));
    assert.equal(view.button('Никто').getAttribute('aria-pressed'), 'true');
    await view.click(view.button('Уведомить'));
    await view.click(item('Исполнитель'));
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await view.type('Выбранному коллеге');
    await view.click(view.send());
    assert.deepEqual(view.calls[0][3], { mode: 'selected', userIds: ['executor'] });
  } finally { await view.close(); }
});
