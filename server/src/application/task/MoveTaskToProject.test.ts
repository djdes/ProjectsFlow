import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TargetProjectIsInboxError } from '../../domain/task/errors.js';
import { MoveTaskToProject } from './MoveTaskToProject.js';

const ME = 'u-me';
const OTHER = 'u-other';
const SOURCE = 'p-named';
const MY_INBOX = 'p-my-inbox';

function makeHarness(opts: {
  inboxOwnerId: string;
  assigneeUserId: string;
  sharedUsers?: string[];
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
        userId === ME ? { role: 'editor' } : null,
      listSharedUsers: async () =>
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
