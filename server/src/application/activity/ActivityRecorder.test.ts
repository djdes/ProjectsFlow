import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActivityRecorder } from './ActivityRecorder.js';
import type { ActivityRepository, RecordActivityInput } from './ActivityRepository.js';

function makeRecorder(opts: {
  resolveWorkspaceId: (projectId: string) => Promise<string | null>;
}) {
  const recorded: RecordActivityInput[] = [];
  let n = 0;
  const activity: ActivityRepository = {
    async record(input) {
      recorded.push(input);
    },
    async listForUserInWorkspace() {
      return [];
    },
    async deleteOlderThan() {
      return 0;
    },
  };
  const recorder = new ActivityRecorder({
    activity,
    resolveWorkspaceId: opts.resolveWorkspaceId,
    idGen: () => `ae-${++n}`,
  });
  return { recorder, recorded };
}

test('record: resolves workspace and persists the event', async () => {
  const { recorder, recorded } = makeRecorder({ resolveWorkspaceId: async () => 'w1' });
  await recorder.record({ projectId: 'p1', actorUserId: 'u2', kind: 'task_created', payload: { taskExcerpt: 'X' } });
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]!.workspaceId, 'w1');
  assert.equal(recorded[0]!.kind, 'task_created');
});

test('record: skips when workspace cannot be resolved (project gone)', async () => {
  const { recorder, recorded } = makeRecorder({ resolveWorkspaceId: async () => null });
  await recorder.record({ projectId: 'gone', actorUserId: 'u2', kind: 'task_deleted' });
  assert.equal(recorded.length, 0);
});

test('record: best-effort — never throws if resolver/repo fails', async () => {
  const { recorder, recorded } = makeRecorder({
    resolveWorkspaceId: async () => {
      throw new Error('db down');
    },
  });
  await recorder.record({ projectId: 'p1', actorUserId: 'u2', kind: 'task_created' });
  assert.equal(recorded.length, 0); // не упало, просто пропустило
});

test('record: explicit workspaceId avoids resolver lookup', async () => {
  let resolverCalled = false;
  const { recorder, recorded } = makeRecorder({
    resolveWorkspaceId: async () => {
      resolverCalled = true;
      return 'w-other';
    },
  });
  await recorder.record({ projectId: 'p1', actorUserId: 'u2', kind: 'project_deleted', workspaceId: 'w1' });
  assert.equal(resolverCalled, false);
  assert.equal(recorded[0]!.workspaceId, 'w1');
});
