import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CommitTaskMismatchError, LinkCommit } from './LinkCommit.js';

function harness(message: string) {
  let writes = 0;
  const task = { id: '12345678-task', projectId: 'p', status: 'pending_approval' };
  const service = new LinkCommit({
    projects: { getById: async () => ({ gitRepoUrl: 'https://github.com/owner/repo' }) },
    members: { findForProject: async () => ({ role: 'editor' }) },
    tasks: { getById: async () => task },
    tokens: { getWithTokenByUserId: async () => ({ accessToken: 'test', githubLogin: 'owner' }) },
    taskCommits: { link: async () => { writes++; return { linked: true }; } },
    api: { getCommit: async () => ({ sha: 'a'.repeat(40), message }) },
  } as never);
  return { service, writes: () => writes };
}
const command = { taskId: '12345678-task', projectId: 'p', ownerUserId: 'u', sha: 'a'.repeat(40), requireTaskMarker: true };

test('agent auto-link rejects fetched upstream commits and commits marked for a different task', async () => {
  for (const message of ['feat: deployment', 'fix: invites [abcdef12]', 'fix: 12345678']) {
    const h = harness(message);
    await assert.rejects(h.service.execute(command), CommitTaskMismatchError);
    assert.equal(h.writes(), 0);
  }
});
test('a task-marked worker commit is linked and an explicit human link remains available', async () => {
  for (const [message, requireTaskMarker] of [['fix: sidebar [12345678]', true], ['feat: manual link', false]] as const) {
    const h = harness(message);
    await h.service.execute({ ...command, requireTaskMarker });
    assert.equal(h.writes(), 1);
  }
});
