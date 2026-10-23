import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configureAdminBypass } from '../project/projectAccess.js';
import { InsufficientProjectRoleError, ProjectNotFoundError } from '../../domain/project/errors.js';
import { GetTask } from './GetTask.js';
import { ListTasks } from './ListTasks.js';
import {
  requireTaskModifyAccess, requireTaskDeleteAccess, type TaskAccessDeps,
} from './taskAuthorization.js';

function deps(assignee = 'worker'): TaskAccessDeps {
  return {
    projects: { getById: async () => ({ id: 'p', ownerId: 'owner', isInbox: false }) } as never,
    tasks: {
      getById: async () => ({ id: 't', projectId: 'p', createdBy: 'creator', assignee: { userId: assignee } }),
      getByIdIncludingDeleted: async () => ({ id: 't', projectId: 'p', createdBy: 'creator', assignee: { userId: assignee } }),
    } as never,
    members: {
      findForProject: async (_id: string, userId: string) => {
        if (userId === 'outsider' || userId === 'admin') return null;
        return { role: userId === 'owner' ? 'owner' : userId === 'viewer' ? 'viewer' : 'editor' };
      },
    } as never,
  };
}

test('editor and creator can read a colleague task but cannot manage it', async () => {
  for (const userId of ['editor', 'creator', 'viewer']) {
    const result = await new GetTask(deps()).execute('p', userId, 't');
    assert.equal(result.canEdit, false);
    assert.equal(result.canTransferProject, false);
    for (const action of ['update_task', 'move_task', 'assign_task', 'delegate_task_to_agent', 'cancel_agent_job'] as const) {
      await assert.rejects(() => requireTaskModifyAccess(deps(), 'p', 't', userId, action), InsufficientProjectRoleError);
    }
    for (const includeDeleted of [false, true]) {
      await assert.rejects(() => requireTaskDeleteAccess(deps(), 'p', 't', userId, 'delete_task', { includeDeleted }), InsufficientProjectRoleError);
    }
  }
});

test('current assignee and project owner retain management, including assigned viewer', async () => {
  for (const userId of ['worker', 'owner', 'viewer']) {
    const dependencies = deps(userId === 'viewer' ? 'viewer' : 'worker');
    assert.equal((await new GetTask(dependencies).execute('p', userId, 't')).canEdit, true);
    await requireTaskModifyAccess(dependencies, 'p', 't', userId, 'move_task');
    await requireTaskDeleteAccess(dependencies, 'p', 't', userId, 'delete_task');
  }
});

test('assignment does not bypass removed membership and administrator retains access', async () => {
  await assert.rejects(() => requireTaskModifyAccess(deps('outsider'), 'p', 't', 'outsider', 'move_task'), ProjectNotFoundError);
  configureAdminBypass(async (id) => id === 'admin');
  try {
    const result = await new GetTask(deps()).execute('p', 'admin', 't');
    assert.equal(result.canEdit, true);
    await requireTaskDeleteAccess(deps(), 'p', 't', 'admin', 'delete_task');
  } finally {
    configureAdminBypass(async () => false);
  }
});

test('board capabilities lock colleague tasks while keeping assigned and owner controls', async () => {
  const dependencies = deps();
  const base = await dependencies.tasks.getById('t');
  const list = new ListTasks({
    ...dependencies,
    tasks: { ...dependencies.tasks, listByProject: async () => [
      { ...base!, id: 'mine', assignee: { userId: 'editor' } },
      { ...base!, id: 'foreign', assignee: { userId: 'worker' } },
    ] } as never,
    taskCommits: { countsByTasks: async () => new Map() } as never,
    attachments: { countsByTasks: async () => new Map() } as never,
    comments: { countsByTasks: async () => new Map() } as never,
  });
  assert.deepEqual((await list.execute('p', 'editor')).map((task) => task.canEdit), [true, false]);
  assert.deepEqual((await list.execute('p', 'owner')).map((task) => task.canEdit), [true, true]);
});
