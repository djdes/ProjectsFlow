import assert from 'node:assert/strict';
import test from 'node:test';
import { EnqueueCommitSyncJob } from './EnqueueCommitSyncJob.js';

test('daily commit review is queued even when there are no open tasks or commits', async () => {
  let created: Record<string, unknown> | null = null;
  const useCase = new EnqueueCommitSyncJob({
    projects: {
      async getById() {
        return { id: 'p1', ownerId: 'owner', dispatcherUserId: 'dispatcher' };
      },
    } as never,
    automation: {
      async getConfig() {
        return {
          projectId: 'p1',
          commitSyncEnabled: true,
          commitSyncThresholdHours: 24,
          commitSyncAction: 'propose',
        };
      },
    } as never,
    tasks: {
      async listByProject() {
        return [];
      },
    } as never,
    listProjectCommits: {
      async execute() {
        return [];
      },
    } as never,
    commitSyncJobs: {
      async existsActiveForProject() {
        return false;
      },
      async create(input: Record<string, unknown>) {
        created = input;
        return { id: 'job1', ...input };
      },
    } as never,
  });

  const result = await useCase.execute('p1', new Date('2026-07-17T14:00:00.000Z'));
  assert.equal(result?.id, 'job1');
  assert.ok(created);
  assert.match(String(created!['context']), /открытых задач нет/);
  assert.match(String(created!['context']), /новых коммитов нет/);
  assert.equal(created!['commitsJson'], '{}');
});
