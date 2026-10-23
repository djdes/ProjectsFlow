import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RequestRalphCancel, TaskNotActiveError } from './RequestRalphCancel.js';

function harness(status = 'pending_approval', running = true, role = 'editor') {
  let writes = 0;
  let queries = 0;
  const task = { id: 't', projectId: 'p', status, ralphCancelRequestedAt: null };
  const deps = {
    projects: { getById: async () => ({ id: 'p' }) },
    members: { findForProject: async () => ({ role }) },
    tasks: {
      getById: async () => task,
      requestRalphCancel: async () => { writes++; return { ...task, ralphCancelRequestedAt: new Date() }; },
    },
    live: { listSessions: async () => { queries++; return [{ projectId: 'p', status: running ? 'running' : 'completed' }]; } },
  };
  const service = new RequestRalphCancel(deps as never);
  return { service, writes: () => writes, queries: () => queries, deps };
}
const command = { projectId: 'p', taskId: 't', ownerUserId: 'u' };

test('an editor can stop a resumed worker even while the task is in review or drafts', async () => {
  for (const status of ['pending_approval', 'backlog', 'todo']) {
    const h = harness(status);
    assert.ok((await h.service.execute(command)).ralphCancelRequestedAt);
    assert.equal(h.writes(), 1);
  }
});

test('a completed attempt or done task cannot be canceled', async () => {
  for (const h of [harness('pending_approval', false), harness('backlog', false), harness('done')]) {
    await assert.rejects(h.service.execute(command), TaskNotActiveError);
    assert.equal(h.writes(), 0);
  }
});

test('viewers cannot probe or cancel workers; a task in another project is rejected', async () => {
  const viewer = harness('pending_approval', true, 'viewer');
  await assert.rejects(viewer.service.execute(command), { name: 'InsufficientProjectRoleError' });
  assert.equal(viewer.queries(), 0);
  assert.equal(viewer.writes(), 0);
  const h = harness();
  await assert.rejects(h.service.execute({ ...command, projectId: 'other' }), { name: 'TaskNotFoundError' });
  assert.equal(h.writes(), 0);
});

test('finishing between access check and conditional write cannot report false acceptance', async () => {
  const h = harness();
  h.deps.tasks.requestRalphCancel = async () => ({ id: 't', projectId: 'p', status: 'pending_approval', ralphCancelRequestedAt: null }) as never;
  await assert.rejects(h.service.execute(command), TaskNotActiveError);
});
