import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GetTaskRunDiffs } from './GetTaskRunDiffs.js';
import type { LiveSession } from '../../domain/live/LiveSession.js';

const start = new Date('2026-10-23T13:00:00Z');
const session = { taskId: '12345678-task', projectId: 'p', startedAt: start } as LiveSession;
function harness() {
  const requested: string[] = [];
  const linked = [
    { sha: 'own', message: 'fix: sidebar [12345678]', linkedAt: new Date(start.getTime() + 1000), committedAt: start },
    { sha: 'upstream', message: 'feat: deployment status', linkedAt: new Date(start.getTime() + 2000), committedAt: start },
    { sha: 'other-task', message: 'fix: invites [abcdef12]', linkedAt: new Date(start.getTime() + 3000), committedAt: start },
    { sha: 'previous-run', message: 'fix: earlier [12345678]', linkedAt: new Date(start.getTime() - 1000), committedAt: start },
  ];
  const source = {
    projects: { getById: async () => ({ gitRepoUrl: 'https://github.com/owner/repo' }) },
    tokens: { getWithTokenByUserId: async () => ({ accessToken: 'test', githubLogin: 'owner' }) },
    commits: { listByTask: async () => linked },
    api: { getCommit: async (_token: string, input: { sha: string }) => {
      requested.push(input.sha);
      return { sha: input.sha, message: 'fix: sidebar [12345678]', changedFiles: 1,
        files: [{ path: 'Sidebar.tsx', status: 'modified', additions: 4, deletions: 34, patch: '@@ -1 +1 @@\n-before\n+after' }] };
    } },
  };
  return { source, requested, run: () => new GetTaskRunDiffs(source as never).execute(session, 'u') };
}

test('the run diff contains its sidebar commit, excluding fetched main, other tasks and earlier executions', async () => {
  const h = harness();
  const files = await h.run();
  assert.deepEqual(h.requested, ['own']);
  assert.equal(files?.length, 1);
  assert.equal(files?.[0]?.path, 'Sidebar.tsx');
  assert.equal(files?.[0]?.additions, 4);
  assert.equal(files?.[0]?.deletions, 34);
  assert.match(files?.[0]?.unifiedDiff ?? '', /--- a\/Sidebar.tsx/);
});

test('a continuation without a new published task commit does not repeat its previous changes', async () => {
  const h = harness(); h.source.commits.listByTask = async () => [];
  assert.deepEqual(await h.run(), []);
  assert.deepEqual(h.requested, []);
});

test('GitHub source failure propagates to the completion service rather than inventing a checkout diff', async () => {
  const h = harness(); h.source.api.getCommit = async () => { throw new Error('source unavailable'); };
  await assert.rejects(h.run(), /source unavailable/);
});
