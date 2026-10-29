import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ListWorkspaceTasks } from './ListWorkspaceTasks';
import type { AssignedTask } from '@/domain/task/AssignedTask';

function task(id: string, patch: Partial<AssignedTask> = {}): AssignedTask {
  return { id, projectId: 'project', projectName: 'Проект', isInbox: false,
    status: 'todo', createdAt: new Date('2026-10-01'), assignee: { userId: 'me', displayName: 'Я', avatarUrl: null }, ...patch } as AssignedTask;
}

test('all workspaces include every assignee and status without preview limits, duplicates or empty-space loss', async () => {
  const mine = Array.from({ length: 8 }, (_, index) => task(`mine-${index}`));
  mine.push(task('done', { status: 'done' }), task('draft', { status: 'backlog' }));
  const calls: string[] = [];
  const list = new ListWorkspaceTasks({
    listMineInWorkspace: async (id) => { calls.push(`mine:${id}`); return id === 'a' ? mine : []; },
    listOthersInWorkspace: async (id) => {
      calls.push(`others:${id}`);
      return id === 'a' ? [mine[0]!, task('colleague', { assignee: { userId: 'other', displayName: 'Коллега', avatarUrl: null } })] : [];
    },
  });
  const results = await list.execute(['a', 'b', 'a']);
  assert.deepEqual(calls.sort(), ['mine:a', 'mine:b', 'others:a', 'others:b']);
  assert.equal(results.length, 2);
  const a = results[0]!;
  assert.equal(a.status, 'ready');
  if (a.status !== 'ready') return;
  assert.equal(a.groups[0]!.tasks.length, 11);
  assert.ok(a.groups[0]!.tasks.some((item) => item.status === 'done'));
  assert.ok(a.groups[0]!.tasks.some((item) => item.status === 'backlog'));
  assert.ok(a.groups[0]!.tasks.some((item) => item.assignee.userId === 'other'));
  assert.deepEqual(results[1], { workspaceId: 'b', status: 'ready', groups: [] });
});

test('equally named projects remain separate and personal inbox ownership is explicit', async () => {
  const list = new ListWorkspaceTasks({
    listMineInWorkspace: async () => [task('one', { projectId: 'one', projectName: 'Одинаковое' }),
      task('two', { projectId: 'two', projectName: 'Одинаковое' }),
      task('inbox', { projectId: 'inbox', isInbox: true, inboxOwner: { userId: 'other', displayName: 'Иван' } })],
    listOthersInWorkspace: async () => [],
  });
  const [result] = await list.execute(['workspace']);
  assert.equal(result!.status, 'ready');
  if (result!.status !== 'ready') return;
  assert.equal(result!.groups.length, 3);
  assert.equal(result!.groups.find((item) => item.projectId === 'inbox')!.projectName, 'Личные · Иван');
});

test('a failing or revoked workspace is an explicit error and never masquerades as a complete partial list', async () => {
  const list = new ListWorkspaceTasks({
    listMineInWorkspace: async () => [task('mine')],
    listOthersInWorkspace: async (id) => { if (id === 'revoked') throw new Error('forbidden'); return []; },
  });
  const results = await list.execute(['ok', 'revoked']);
  assert.equal(results[0]!.status, 'ready');
  assert.deepEqual(results[1], { workspaceId: 'revoked', status: 'error' });
});
