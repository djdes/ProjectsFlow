import assert from 'node:assert/strict';
import test from 'node:test';
import type { Project } from '../project/Project';
import { canEditReadableTask, canTransferProject, taskProjectOptions, taskStatusOptions } from './taskEditorOptions';
import type { Task } from './Task';

test('status choices respect disabled worker, hidden columns and configured custom columns', () => {
  assert.deepEqual(taskStatusOptions({ manual: { hidden: true }, custom_2: { label: 'Проверка' } }, false, true, 'manual'),
    ['manual', 'backlog', 'pending_approval', 'done', 'custom_2']);
  assert.deepEqual(taskStatusOptions(null, false, false, 'backlog'), ['backlog', 'manual', 'done']);
  assert.ok(taskStatusOptions(null, true, false, 'backlog').includes('todo'));
});

test('project choices include personal Inbox and writable projects, but never foreign Inbox or viewers', () => {
  const project = (id: string, extra: Partial<Project> = {}): Project => ({ id, ownerId: 'other', isInbox: false, status: 'active', role: 'editor', ...extra } as Project);
  const list = [project('named'), project('mine', { isInbox: true, ownerId: 'me' }), project('foreign', { isInbox: true }), project('view', { role: 'viewer' }), project('old', { status: 'archived' })];
  assert.deepEqual(taskProjectOptions(list, 'me').map((p) => p.id), ['named', 'mine']);
  assert.equal(canTransferProject(list[2], 'me'), false);
  assert.equal(canTransferProject(list[3], 'me'), false);
});

test('read-only task pages keep controls locked except for their current assignee', () => {
  const task = { assignee: { userId: 'assignee' }, creator: { userId: 'author' } } as Task;
  const project = { isInbox: false, role: 'viewer', ownerId: 'owner' } as Project;
  assert.equal(canEditReadableTask(project, task, 'viewer'), false);
  assert.equal(canEditReadableTask(project, task, 'assignee'), true);
  assert.equal(canEditReadableTask(project, task, 'author'), false);
  assert.equal(canEditReadableTask({ ...project, role: 'editor' }, task, 'viewer'), false);
  assert.equal(canEditReadableTask({ ...project, isInbox: true }, task, 'author'), false);
  assert.equal(canEditReadableTask({ ...project, role: 'owner' }, task, 'owner'), true);
  assert.equal(canEditReadableTask(null, task, 'assignee'), false);
});
