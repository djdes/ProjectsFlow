import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ListTasksAssignedToMe } from './ListTasksAssignedToMe.js';
import type { AssignedDelegationRow } from './TaskDelegationRepository.js';
import type { TaskDelegation, TaskDelegationStatus } from '../../domain/task/TaskDelegation.js';
import type { ProjectRole } from '../../domain/project/ProjectMembership.js';

// Минимальные in-memory фейки (tsx + node:test, без новых deps).

function delegation(status: TaskDelegationStatus): TaskDelegation {
  return {
    id: 'd1',
    taskId: 't1',
    delegateUserId: 'me',
    delegateDisplayName: 'Я',
    creatorUserId: 'u-creator',
    creatorDisplayName: 'Создатель',
    status,
    createdAt: new Date(0),
    respondedAt: null,
    revertToUserId: null,
  };
}

function row(over: {
  status?: TaskDelegationStatus;
  isInbox?: boolean;
  delegateRole?: ProjectRole | null;
}): AssignedDelegationRow {
  return {
    taskId: 't1',
    delegation: delegation(over.status ?? 'accepted'),
    projectId: 'p1',
    projectName: 'Проект',
    isInbox: over.isInbox ?? false,
    delegateRole: over.delegateRole === undefined ? 'editor' : over.delegateRole,
  };
}

function makeList(rows: AssignedDelegationRow[]): ListTasksAssignedToMe {
  return new ListTasksAssignedToMe({
    delegations: { listAssignedTo: async () => rows } as never,
    tasks: {
      listByIds: async (ids: readonly string[]) =>
        ids.map((id) => ({ id, projectId: 'p1', description: 'x' })),
    } as never,
    taskCommits: { countsByTasks: async () => new Map<string, number>() } as never,
    attachments: { countsByTasks: async () => new Map<string, number>() } as never,
    comments: { countsByTasks: async () => new Map<string, number>() } as never,
  });
}

test('canModify: editor именованного проекта — true БЕЗ гейта по статусу (легаси pending-строка)', async () => {
  const items = await makeList([row({ status: 'pending', delegateRole: 'editor' })]).execute('me');
  assert.equal(items.length, 1);
  assert.equal(items[0]!.canModify, true);
});

test('canModify: viewer — false (гейт по роли сохранён)', async () => {
  const items = await makeList([row({ delegateRole: 'viewer' })]).execute('me');
  assert.equal(items.length, 1);
  assert.equal(items[0]!.canModify, false);
});

test('inbox-строка: видима и canModify=true (роль null — норма для инбокса)', async () => {
  const items = await makeList([row({ isInbox: true, delegateRole: null })]).execute('me');
  assert.equal(items.length, 1);
  assert.equal(items[0]!.canModify, true);
});

test('именованный проект без роли (делегата убрали) — строка отфильтрована, даже для легаси pending_invite', async () => {
  const items = await makeList([
    row({ delegateRole: null }),
    row({ status: 'pending_invite', delegateRole: null }),
  ]).execute('me');
  assert.equal(items.length, 0);
});
