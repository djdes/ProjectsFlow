import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GithubActionsDeploymentRepository } from './GithubActionsDeploymentRepository.js';
import { FileDeployedRevision } from './FileDeployedRevision.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('reads the actual running workflow attempt, ignoring unrelated branches and a newer queued run', async () => {
  const calls: string[] = [];
  let audited = '';
  const source = new GithubActionsDeploymentRepository({ repository: 'djdes/ProjectsFlow', workflow: 'deploy.yml',
    getCredential: async () => ({ accessToken: 'test-only', onUsed: async id => { audited = id; } }),
    fetch: (async (url, options) => {
      calls.push(String(url));
      assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer test-only');
      return Response.json(calls.length === 1 ? { workflow_runs: [
        { id: 4, head_branch: 'feature', status: 'in_progress' },
        { id: 3, head_branch: 'main', status: 'queued' },
        { id: 2, run_attempt: 4, head_branch: 'main', status: 'in_progress', head_sha: 'a'.repeat(40), created_at: 'now', updated_at: 'now' },
      ] } : { jobs: [{ name: 'deploy', steps: [{ name: 'Build client', status: 'in_progress', conclusion: null }] }] });
    }) as typeof fetch,
  });
  const run = await source.latest();
  assert.equal(run?.id, '2'); assert.equal(run.attempt, 4); assert.equal(audited, '2');
  assert.match(calls[1]!, /runs\/2\/attempts\/4\/jobs/);
  assert.equal(run.steps[0]?.name, 'Build client');
  assert.doesNotMatch(JSON.stringify(run), /test-only|Authorization/);
});

test('upstream failures do not expose tokens or masquerade as an idle workflow', async () => {
  const source = new GithubActionsDeploymentRepository({ repository: 'djdes/ProjectsFlow', workflow: 'deploy.yml',
    getCredential: async () => ({ accessToken: 'do-not-expose' }), fetch: (async () => new Response('secret error', { status: 403 })) as typeof fetch });
  await assert.rejects(() => source.latest(), error => error instanceof Error && error.message === 'deployment_source_unavailable');
});

test('deployed revision comes from the installed build artifact, with missing/malformed files treated as unknown', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pf-deployed-revision-'));
  try {
    const file = join(directory, 'build.json'); const source = new FileDeployedRevision(file);
    assert.equal(await source.read(), null);
    await writeFile(file, JSON.stringify({ revision: 'a'.repeat(40) })); assert.equal(await source.read(), 'a'.repeat(40));
    await writeFile(file, JSON.stringify({ revision: 'dev' })); assert.equal(await source.read(), null);
    await writeFile(file, '{'); assert.equal(await source.read(), null);
  } finally {
    assert.ok(directory.startsWith(join(tmpdir(), 'pf-deployed-revision-')));
    await rm(directory, { recursive: true, force: true });
  }
});
