import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ListCommentNotifyCandidates } from './ListCommentNotifyCandidates.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';

type Person = { id: string; displayName: string };

function memberRow(p: Person, role = 'editor') {
  return {
    projectId: 'p1', userId: p.id, role, joinedAt: new Date(), notificationPrefs: null,
    user: { id: p.id, displayName: p.displayName, email: `${p.id}@x`, avatarUrl: null },
  };
}

const me = { id: 'me', displayName: 'Олег' };
const denis = { id: 'denis', displayName: 'Денис Волков' };
const owner = { id: 'owner', displayName: 'Владелец' };
const dev = { id: 'dev', displayName: 'Ярослав' };

function makeUseCase(opts: { inbox: boolean; workspace: Person[]; leads: string[]; owners: string[]; assignee: string }) {
  const project = opts.inbox
    ? { id: 'p1', name: 'inbox:me', isInbox: true, ownerId: 'me', workspaceId: 'w1' }
    : { id: 'p1', name: 'Проект', isInbox: false, ownerId: 'owner', workspaceId: 'w1' };
  const task = { id: 't1', projectId: 'p1', assignee: { userId: opts.assignee }, createdBy: 'me' };
  const people = [me, denis, owner, dev];
  return new ListCommentNotifyCandidates({
    projects: { getById: async () => project } as never,
    tasks: { getById: async () => task } as never,
    members: {
      findForProject: async (_p: string, userId: string) =>
        opts.workspace.some((w) => w.id === userId) ? { projectId: 'p1', userId, role: 'editor', joinedAt: new Date() } : null,
      listByProject: async () => (opts.inbox ? [memberRow(me, 'owner')] : opts.workspace.map((p) => memberRow(p))),
      listApproverUserIdsForProject: async () => [...opts.leads, ...opts.owners],
      listLeadUserIdsForProject: async () => opts.leads,
      isProjectHidden: async () => false,
      getNotificationPrefs: async () => null,
      listSharedUsersInWorkspace: async () => [],
    } as never,
    users: { getById: async (id: string) => {
      const p = people.find((x) => x.id === id);
      return p ? { id: p.id, displayName: p.displayName, email: `${p.id}@x`, avatarUrl: null } : null;
    } } as never,
  });
}

test('personal inbox task: lead from «Кто утверждает» is the default, workspace owner is selectable', async () => {
  const useCase = makeUseCase({ inbox: true, workspace: [me, denis, owner, dev], leads: ['denis'], owners: ['owner'], assignee: 'me' });
  const list = await useCase.execute('p1', 'me', 't1');
  assert.deepEqual(list.map((c) => [c.userId, c.isDefault]), [['denis', true], ['owner', false]]);
  // A regular colleague cannot open somebody's personal task, so he is not offered.
  assert.equal(list.some((c) => c.userId === 'dev'), false);
});

test('project task: any workspace member can be notified, the lead is the default', async () => {
  const useCase = makeUseCase({ inbox: false, workspace: [me, denis, owner, dev], leads: ['denis'], owners: ['owner'], assignee: 'me' });
  const list = await useCase.execute('p1', 'me', 't1');
  assert.deepEqual(list.map((c) => c.userId), ['denis', 'owner', 'dev']);
  assert.deepEqual(list.filter((c) => c.isDefault).map((c) => c.userId), ['denis']);
  assert.deepEqual(list.filter((c) => c.isManager).map((c) => c.userId), ['denis', 'owner']);
});

test('lead commenting on an employee task defaults to the assignee', async () => {
  const useCase = makeUseCase({ inbox: false, workspace: [me, denis, owner, dev], leads: ['denis'], owners: ['owner'], assignee: 'dev' });
  const list = await useCase.execute('p1', 'denis', 't1');
  assert.deepEqual(list.filter((c) => c.isDefault).map((c) => c.userId), ['dev']);
  assert.equal(list.some((c) => c.userId === 'denis'), false);
});

test('a user without access to the task gets 404', async () => {
  const useCase = makeUseCase({ inbox: false, workspace: [me, denis], leads: ['denis'], owners: [], assignee: 'me' });
  await assert.rejects(useCase.execute('p1', 'stranger', 't1'), ProjectNotFoundError);
});
