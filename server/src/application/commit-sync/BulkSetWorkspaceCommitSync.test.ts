import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BulkSetWorkspaceCommitSync } from './BulkSetWorkspaceCommitSync.js';
import type { WorkspaceRepository } from '../workspace/WorkspaceRepository.js';
import type { AutomationRepository } from '../automation/AutomationRepository.js';
import { WorkspaceNotFoundError } from '../../domain/workspace/errors.js';

const WORKSPACE_ID = 'workspace-1';
const MEMBER_ID = 'member-1';

type BulkArgs = Parameters<AutomationRepository['bulkSetCommitSync']>[1];

function makeUseCase() {
  let lastArgs: BulkArgs | null = null;

  const workspaces = {
    async getMembership(workspaceId: string, userId: string) {
      if (workspaceId !== WORKSPACE_ID || userId !== MEMBER_ID) return null;
      return { workspaceId, userId, role: 'viewer' as const };
    },
  } as unknown as WorkspaceRepository;

  const automation = {
    async bulkSetCommitSync(_workspaceId: string, input: BulkArgs) {
      lastArgs = input;
      return 3;
    },
  } as unknown as Pick<AutomationRepository, 'bulkSetCommitSync'>;

  return {
    useCase: new BulkSetWorkspaceCommitSync({ workspaces, automation }),
    getLastArgs: () => lastArgs,
  };
}

test('bulk commit-sync propagates the mode to all projects', async () => {
  const { useCase, getLastArgs } = makeUseCase();

  const { affected } = await useCase.execute(WORKSPACE_ID, MEMBER_ID, {
    enabled: true,
    hour: 18,
    minute: 30,
    daysOfWeek: [1, 2, 3],
    action: 'auto',
  });

  assert.equal(affected, 3);
  assert.equal(getLastArgs()?.action, 'auto');
  assert.equal(getLastArgs()?.enabled, true);
  assert.deepEqual([...(getLastArgs()?.daysOfWeek ?? [])], [1, 2, 3]);
});

test('bulk commit-sync treats an empty day list as every day', async () => {
  const { useCase, getLastArgs } = makeUseCase();

  await useCase.execute(WORKSPACE_ID, MEMBER_ID, {
    enabled: false,
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
        enabled: true,
        hour: 17,
        minute: 0,
        daysOfWeek: [1, 2, 3, 4, 5],
        action: 'auto',
      }),
    WorkspaceNotFoundError,
  );
});
