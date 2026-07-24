import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BulkSetWorkspaceCommitSync } from './BulkSetWorkspaceCommitSync.js';
import type { WorkspaceRepository } from '../workspace/WorkspaceRepository.js';
import type { AutomationRepository } from '../automation/AutomationRepository.js';
import { WorkspaceNotFoundError } from '../../domain/workspace/errors.js';

const WORKSPACE_ID = 'workspace-1';
const MEMBER_ID = 'member-1';

type ScheduleArgs = Parameters<AutomationRepository['bulkSetCommitSyncSchedule']>[1];

function makeUseCase() {
  let lastArgs: ScheduleArgs | null = null;

  const workspaces = {
    async getMembership(workspaceId: string, userId: string) {
      if (workspaceId !== WORKSPACE_ID || userId !== MEMBER_ID) return null;
      return { workspaceId, userId, role: 'viewer' as const };
    },
  } as unknown as WorkspaceRepository;

  const automation = {
    async bulkSetCommitSyncSchedule(_workspaceId: string, input: ScheduleArgs) {
      lastArgs = input;
      return 3;
    },
  } as unknown as Pick<AutomationRepository, 'bulkSetCommitSyncSchedule'>;

  return {
    useCase: new BulkSetWorkspaceCommitSync({ workspaces, automation }),
    getLastArgs: () => lastArgs,
  };
}

test('bulk commit-sync applies the shared schedule to all projects (no enabled)', async () => {
  const { useCase, getLastArgs } = makeUseCase();

  const { affected } = await useCase.execute(WORKSPACE_ID, MEMBER_ID, {
    hour: 18,
    minute: 30,
    daysOfWeek: [1, 2, 3],
    action: 'auto',
  });

  assert.equal(affected, 3);
  assert.equal(getLastArgs()?.action, 'auto');
  assert.equal(getLastArgs()?.hour, 18);
  assert.equal(getLastArgs()?.minute, 30);
  assert.deepEqual([...(getLastArgs()?.daysOfWeek ?? [])], [1, 2, 3]);
  // enabled больше не часть расписания — режим/время не должны нести флаг включённости.
  assert.equal('enabled' in (getLastArgs() as object), false);
});

test('bulk commit-sync treats an empty day list as every day', async () => {
  const { useCase, getLastArgs } = makeUseCase();

  await useCase.execute(WORKSPACE_ID, MEMBER_ID, {
    hour: 17,
    minute: 0,
    daysOfWeek: [],
    action: 'propose',
  });

  assert.deepEqual([...(getLastArgs()?.daysOfWeek ?? [])], [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(getLastArgs()?.action, 'propose');
});

test('bulk commit-sync stays closed to non-members', async () => {
  const { useCase } = makeUseCase();

  await assert.rejects(
    () =>
      useCase.execute(WORKSPACE_ID, 'outsider', {
        hour: 17,
        minute: 0,
        daysOfWeek: [1, 2, 3, 4, 5],
        action: 'auto',
      }),
    WorkspaceNotFoundError,
  );
});
