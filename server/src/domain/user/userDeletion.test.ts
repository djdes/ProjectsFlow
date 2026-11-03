import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeDeletionBlockers, planUserDeletion, type UserDeletionSnapshot, type UserDeletionWorkspace } from './userDeletion.js';

const ws = (patch: Partial<UserDeletionWorkspace> & { id: string }): UserDeletionWorkspace => ({
  name: patch.id, kind: 'team', role: 'editor', recordedOwner: false, otherActiveMembers: 1,
  successor: { id: 'boss', displayName: 'Босс' }, successorIsOwner: true, ...patch,
});
const snapshot = (patch: Partial<UserDeletionSnapshot> = {}): UserDeletionSnapshot => ({
  userId: 'u', isAdmin: false, workspaces: [], projects: [], ...patch,
});

test('self and admin targets are blocked', () => {
  assert.deepEqual(planUserDeletion(snapshot({ userId: 'me' }), 'me').blockers, [{ kind: 'self' }]);
  const admin = planUserDeletion(snapshot({ isAdmin: true }), 'me');
  assert.deepEqual(admin.blockers, [{ kind: 'admin' }]);
  assert.match(describeDeletionBlockers(admin.blockers), /снимите права администратора/);
});

test('a workspace owned alone is removed with all its projects and inbox', () => {
  const plan = planUserDeletion(snapshot({
    workspaces: [ws({ id: 'personal', kind: 'default', role: 'owner', recordedOwner: true, otherActiveMembers: 0, successor: null, successorIsOwner: false })],
    projects: [
      { id: 'p1', name: 'Сайт', workspaceId: 'personal', isInbox: false, ownerId: 'u', taskCount: 4, assignedToUser: 4 },
      { id: 'in', name: 'Входящие', workspaceId: 'personal', isInbox: true, ownerId: 'u', taskCount: 2, assignedToUser: 2 },
    ],
  }), 'me');
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(plan.removeWorkspaces.map((w) => w.id), ['personal']);
  assert.deepEqual(plan.removeProjectIds, ['p1', 'in']);
  assert.deepEqual(plan.reassignments, []);
  assert.equal(plan.summary.removedTasks, 6);
});

test('a sole-owned team workspace with members blocks; a co-owned one passes to the other owner', () => {
  const blocked = planUserDeletion(snapshot({
    workspaces: [ws({ id: 'team', name: 'Команда', role: 'owner', recordedOwner: true, otherActiveMembers: 3,
      successor: { id: 'lead', displayName: 'Лид' }, successorIsOwner: false })],
  }), 'me');
  assert.deepEqual(blocked.blockers, [{ kind: 'owned_workspace', workspaceId: 'team', name: 'Команда', members: 3 }]);
  assert.match(describeDeletionBlockers(blocked.blockers), /«Команда».*другого владельца/);

  const shared = planUserDeletion(snapshot({
    workspaces: [ws({ id: 'team', role: 'owner', recordedOwner: true, successor: { id: 'co', displayName: 'Совладелец' } })],
    projects: [{ id: 'p', name: 'Сайт', workspaceId: 'team', isInbox: false, ownerId: 'u', taskCount: 3, assignedToUser: 1 }],
  }), 'me');
  assert.deepEqual(shared.blockers, []);
  assert.deepEqual(shared.ownerTransfers, [{ workspaceId: 'team', toUserId: 'co' }]);
  assert.deepEqual(shared.reassignments, [{ projectId: 'p', toUserId: 'co', tasks: 1, ownership: true }]);
});

test('in a team workspace: own inbox goes, tasks move to the owner, foreign inboxes back to their owner', () => {
  const plan = planUserDeletion(snapshot({
    workspaces: [ws({ id: 'team', name: 'Команда' })],
    projects: [
      { id: 'mine', name: 'Входящие', workspaceId: 'team', isInbox: true, ownerId: 'u', taskCount: 2, assignedToUser: 2 },
      { id: 'site', name: 'Сайт', workspaceId: 'team', isInbox: false, ownerId: 'boss', taskCount: 9, assignedToUser: 3 },
      { id: 'quiet', name: 'Без задач', workspaceId: 'team', isInbox: false, ownerId: 'boss', taskCount: 1, assignedToUser: 0 },
      { id: 'theirs', name: 'Входящие', workspaceId: 'team', isInbox: true, ownerId: 'emp', taskCount: 1, assignedToUser: 1 },
    ],
  }), 'me');
  assert.deepEqual(plan.removeWorkspaces, []);
  assert.deepEqual(plan.removeProjectIds, ['mine']);
  assert.deepEqual(plan.reassignments, [
    { projectId: 'site', toUserId: 'boss', tasks: 3, ownership: false },
    { projectId: 'theirs', toUserId: 'emp', tasks: 1, ownership: false },
  ]);
  assert.deepEqual(plan.summary, {
    removedProjects: 1, removedTasks: 2, reassignedTasks: 4, leftWorkspaces: [{ name: 'Команда', successorName: 'Босс' }],
  });
});
