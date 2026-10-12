import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GetTask } from './GetTask.js';
import { requireTaskModifyAccess, requireTaskDeleteAccess, type TaskAccessDeps } from './taskAuthorization.js';
import { ProjectNotFoundError } from '../../domain/project/errors.js';

function harness(inbox = true, hidden = false): TaskAccessDeps {
  return {
    projects: { getById: async () => ({ id: 'p1', ownerId: 'worker', isInbox: inbox }) } as never,
    tasks: { getById: async () => ({ id: 't1', projectId: 'p1', createdBy: 'worker', assignee: { userId: 'worker' } }) } as never,
    members: {
      listApproverUserIdsForProject: async () => ['owner', 'lead'],
      isProjectHidden: async () => hidden,
      listSharedUsers: async () => [{ id: 'worker' }],
      findForProject: async (_p: string, userId: string) => inbox ? null : ({ userId, role: 'viewer' }),
    } as never,
  };
}

test('workspace owner and approver can open, edit and complete/delete the individual inbox task', async () => {
  const deps = harness();
  for (const actor of ['owner', 'lead']) {
    const result = await new GetTask(deps).execute('p1', actor, 't1');
    assert.equal(result.id, 't1');
    assert.equal(result.canEdit, true);
    await requireTaskModifyAccess(deps, 'p1', 't1', actor, 'move_task');
    await requireTaskDeleteAccess(deps, 'p1', 't1', actor, 'delete_task');
  }
});

test('ordinary colleague and a manager from another workspace cannot open a private task', async () => {
  for (const actor of ['colleague', 'other-workspace-lead']) {
    await assert.rejects(() => new GetTask(harness()).execute('p1', actor, 't1'), ProjectNotFoundError);
  }
});

test('explicit project exclusion overrides the approver role', async () => {
  await assert.rejects(() => new GetTask(harness(true, true)).execute('p1', 'lead', 't1'), ProjectNotFoundError);
});

test('named project viewer can read but cannot edit somebody else task', async () => {
  const result = await new GetTask(harness(false)).execute('p1', 'colleague', 't1');
  assert.equal(result.canEdit, false);
});

test('task-scoped URL cannot be used with another project id', async () => {
  await assert.rejects(() => new GetTask(harness()).execute('other', 'worker', 't1'), ProjectNotFoundError);
});
