import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TargetProjectIsInboxError } from '../../domain/task/errors.js';
import { ProjectNotFoundError, InsufficientProjectRoleError } from '../../domain/project/errors.js';
import { MoveTaskToProject } from './MoveTaskToProject.js';

const ME = 'u-me';
const OTHER = 'u-other';
const SOURCE = 'p-named';
const MY_INBOX = 'p-my-inbox';

function makeHarness(opts: {
  inboxOwnerId: string;
  assigneeUserId: string;
  sharedUsers?: string[];
  sourceRole?: string;
}) {
  const moves: { projectId: string; assigneeUserId: string }[] = [];
  const move = new MoveTaskToProject({
    tasks: {
      getById: async () => ({
        id: 't1',
        projectId: SOURCE,
        description: 'x',
        assignee: {
          userId: opts.assigneeUserId,
          displayName: opts.assigneeUserId,
          avatarUrl: null,
        },
      }),
      moveToProject: async (_taskId: string, projectId: string, assigneeUserId: string) => {
        moves.push({ projectId, assigneeUserId });
        return {
          id: 't1',
          projectId,
          description: 'x',
          assignee: { userId: assigneeUserId, displayName: assigneeUserId, avatarUrl: null },
        };
      },
    } as never,
    projects: {
      getById: async (id: string) =>
        id === SOURCE
          ? { id: SOURCE, isInbox: false, ownerId: OTHER, name: 'Проект' }
          : { id, isInbox: true, ownerId: opts.inboxOwnerId, name: 'Входящие' },
    } as never,
    members: {
      findForProject: async (_projectId: string, userId: string) =>
        userId === ME ? { role: opts.sourceRole ?? 'owner' } : null,
      listSharedUsersInWorkspace: async () =>
        (opts.sharedUsers ?? []).map((id) => ({ id })),
    } as never,
  });
  return { move, moves };
}

test('moving to own Inbox preserves an eligible assignee', async () => {
  const h = makeHarness({
    inboxOwnerId: ME,
    assigneeUserId: OTHER,
    sharedUsers: [OTHER],
  });

  const moved = await h.move.execute('t1', MY_INBOX, ME);
  assert.equal(moved.projectId, MY_INBOX);
  assert.deepEqual(h.moves, [{ projectId: MY_INBOX, assigneeUserId: OTHER }]);
});

test('moving to own Inbox falls back to the caller when the assignee is not eligible', async () => {
  const h = makeHarness({ inboxOwnerId: ME, assigneeUserId: OTHER });

  await h.move.execute('t1', MY_INBOX, ME);
  assert.deepEqual(h.moves, [{ projectId: MY_INBOX, assigneeUserId: ME }]);
});

test('moving to somebody else\'s Inbox is forbidden', async () => {
  const h = makeHarness({ inboxOwnerId: OTHER, assigneeUserId: ME });

  await assert.rejects(
    () => h.move.execute('t1', 'p-foreign-inbox', ME),
    TargetProjectIsInboxError,
  );
  assert.equal(h.moves.length, 0);
});

test('personal task moves to a writable project with its assignee preserved', async () => {
  const h = personalMoveHarness('owner', ME);
  const moved = await h.move.execute('personal-task', 'destination', ME);
  assert.equal(moved.projectId, 'destination');
  assert.deepEqual(h.moves, [OTHER]);
});

test('unrelated colleague cannot move a personal task even with destination write access', async () => {
  const h = personalMoveHarness('owner', OTHER);
  await assert.rejects(h.move.execute('personal-task', 'destination', ME), ProjectNotFoundError);
  assert.deepEqual(h.moves, []);
});

test('personal task transfer is denied when the destination only grants viewing', async () => {
  const h = personalMoveHarness('viewer', ME);
  await assert.rejects(h.move.execute('personal-task', 'destination', ME));
  assert.deepEqual(h.moves, []);
});

test('personal task can be transferred by its assignee or workspace approver', async () => {
  for (const access of [{ assignee: ME }, { approvers: [ME] }]) {
    const h = personalMoveHarness('editor', OTHER, access);
    const moved = await h.move.execute('personal-task', 'destination', ME);
    assert.equal(moved.projectId, 'destination');
    assert.deepEqual(h.moves, [access.assignee ?? OTHER]);
  }
});

test('delegating author cannot transfer a task assigned to a colleague', async () => {
  const h = personalMoveHarness('editor', OTHER, { creator: ME, sharedUsers: [OTHER] });
  await assert.rejects(h.move.execute('personal-task', 'destination', ME), ProjectNotFoundError);
  assert.deepEqual(h.moves, []);
});

test('approver cannot transfer into a read-only project or from an excluded inbox', async () => {
  const readOnly = personalMoveHarness('viewer', OTHER, { approvers: [ME] });
  await assert.rejects(readOnly.move.execute('personal-task', 'destination', ME), InsufficientProjectRoleError);
  const hidden = personalMoveHarness('editor', OTHER, { approvers: [ME], hidden: true });
  await assert.rejects(hidden.move.execute('personal-task', 'destination', ME), ProjectNotFoundError);
  assert.deepEqual([...readOnly.moves, ...hidden.moves], []);
});

test('assigned viewer cannot transfer a named project task out of its project', async () => {
  const h = makeHarness({ inboxOwnerId: ME, assigneeUserId: ME, sourceRole: 'viewer' });
  await assert.rejects(h.move.execute('t1', MY_INBOX, ME), InsufficientProjectRoleError);
  assert.deepEqual(h.moves, []);
});

function personalMoveHarness(targetRole: string, inboxOwner: string, access: {
  assignee?: string; creator?: string; sharedUsers?: string[]; approvers?: string[]; hidden?: boolean;
} = {}) {
  const moves: string[] = [];
  const sourceTask = { id: 'personal-task', projectId: MY_INBOX, createdBy: access.creator, assignee: { userId: access.assignee ?? OTHER } };
  const move = new MoveTaskToProject({
    projects: { getById: async (id: string) => ({ id, isInbox: id === MY_INBOX, ownerId: id === MY_INBOX ? inboxOwner : OTHER }) } as never,
    members: {
      findForProject: async (_id: string, userId: string) => ({ role: userId === ME ? targetRole : 'editor' }),
      listApproverUserIdsForProject: async () => access.approvers ?? [],
      listSharedUsersInWorkspace: async () => (access.sharedUsers ?? []).map(id => ({ id })),
      isProjectHidden: async () => access.hidden ?? false,
    } as never,
    tasks: {
      getById: async () => sourceTask,
      moveToProject: async (_id: string, projectId: string, assigneeUserId: string) => {
        moves.push(assigneeUserId);
        return { ...sourceTask, projectId, assignee: { userId: assigneeUserId } };
      },
    } as never,
  });
  return { moves, move };
}
