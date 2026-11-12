import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskVisibility } from './TaskVisibility.js';
import type { ProjectSharing } from '../../domain/project/ProjectSharing.js';
import type { WorkspaceRole } from '../../domain/workspace/WorkspaceMember.js';

// Проект p: основное «dev» (все задачи), подключено «office» (только свои). Проект q — не общий.
const sharingP: ProjectSharing & { creatorUserId: string } = {
  projectId: 'p',
  homeWorkspaceId: 'dev',
  creatorUserId: 'author',
  workspaces: new Map([['dev', { kind: 'all' }], ['office', { kind: 'own' }]]),
  members: new Map(),
};
const membersOf: Array<{ workspaceId: string; userId: string; role: WorkspaceRole; excluded?: boolean }> = [
  { workspaceId: 'dev', userId: 'coder', role: 'editor' },
  { workspaceId: 'office', userId: 'manager', role: 'editor' },
  { workspaceId: 'dev', userId: 'both', role: 'editor' },
  { workspaceId: 'office', userId: 'both', role: 'editor' },
  { workspaceId: 'dev', userId: 'devlead', role: 'lead' },
  { workspaceId: 'dev', userId: 'author', role: 'editor' },
  { workspaceId: 'office', userId: 'exauthor', role: 'editor' },
  { workspaceId: 'office', userId: 'hidden', role: 'editor', excluded: true },
];

function make(context: Record<string, string | null> = {}, admins: string[] = []) {
  return new TaskVisibility({
    sharing: {
      async loadMany(ids) {
        return new Map(ids.includes('p') ? [['p', sharingP]] : []);
      },
      async memberships(userIds, projects) {
        return projects.flatMap((p) =>
          membersOf
            .filter((m) => userIds.includes(m.userId) && p.workspaceIds.includes(m.workspaceId))
            .map((m) => ({ ...m, excluded: m.excluded ?? false, projectId: p.projectId })),
        );
      },
    },
    currentWorkspaceId: (userId) => context[userId] ?? null,
    isSystemAdmin: async (userId) => admins.includes(userId),
  });
}

const task = (id: string, projectId: string, origin: string | null, author = 'x') => ({
  id,
  projectId,
  createdBy: author,
  assignee: { userId: author },
  originWorkspaceId: origin,
});
const devTask = task('dev-1', 'p', null);
const officeTask = task('office-1', 'p', 'office');
const otherProject = task('q-1', 'q', null);

test('board in a workspace shows that workspace rule; unshared projects pass through', async () => {
  const v = make({ manager: 'office', coder: 'dev', both: 'office' });
  const ids = async (userId: string) => (await v.filterTasks(userId, [devTask, officeTask, otherProject])).map((t) => t.id);
  assert.deepEqual(await ids('coder'), ['dev-1', 'office-1', 'q-1']);
  assert.deepEqual(await ids('manager'), ['office-1', 'q-1']);
  assert.deepEqual(await ids('both'), ['office-1', 'q-1'], 'in the office context the office rule applies');
});

test('direct link (no context) unites the rules of all member workspaces', async () => {
  const v = make();
  assert.equal(await v.canSee('both', devTask), true);
  assert.equal(await v.canSee('manager', devTask), false);
});

test('admins: project author, home lead and system admins see everything', async () => {
  const v = make({}, ['root']);
  assert.equal(await v.canSee('author', officeTask), true);
  assert.equal(await v.canSee('devlead', officeTask), true);
  assert.equal(await v.canSee('root', devTask), true);
});

test('the project author who is only a guest no longer sees everything', async () => {
  const v = make();
  const guestAuthorSharing = { ...sharingP, creatorUserId: 'exauthor' };
  const guest = new TaskVisibility({
    sharing: {
      async loadMany() {
        return new Map([['p', guestAuthorSharing]]);
      },
      memberships: (userIds, projects) => v['deps'].sharing.memberships(userIds, projects),
    },
  });
  assert.equal(await guest.canSee('exauthor', devTask), false);
  assert.equal(await guest.canSee('exauthor', officeTask), true);
});

test('a member hidden from the project by the workspace checkbox sees nothing of it', async () => {
  const v = make();
  assert.equal(await v.canSee('hidden', officeTask), false);
});

test('audience of a task and workspace-wide digests follow the same rules', async () => {
  const v = make();
  assert.deepEqual(await v.filterAudience(devTask, ['coder', 'manager', 'both', 'x']), ['coder', 'both', 'x']);
  assert.deepEqual(await v.filterAudience(otherProject, ['a', 'b']), ['a', 'b']);
  assert.deepEqual((await v.filterForWorkspace('office', [devTask, officeTask, otherProject])).map((t) => t.id), ['office-1', 'q-1']);
  assert.deepEqual((await v.filterForWorkspace('dev', [devTask, officeTask])).map((t) => t.id), ['dev-1', 'office-1']);
});
