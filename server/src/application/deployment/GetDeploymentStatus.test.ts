import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploymentPhase, type DeploymentRun } from '../../domain/deployment/DeploymentStatus.js';
import { GetDeploymentStatus } from './GetDeploymentStatus.js';

const revision = 'a'.repeat(40);
function run(input: Partial<DeploymentRun> = {}): DeploymentRun {
  return { id: '1', attempt: 1, status: 'in_progress', conclusion: null, revision,
    startedAt: '2026-10-23T12:00:00Z', updatedAt: '2026-10-23T12:00:00Z', steps: [], ...input };
}
test('phases follow runner steps and success requires the deployed artifact revision', () => {
  assert.equal(deploymentPhase(null, revision), 'idle');
  assert.equal(deploymentPhase(run({ status: 'queued' }), revision), 'queued');
  for (const [name, phase] of [['Typecheck', 'checking'], ['Smoke tests', 'checking'], ['Build client', 'building'],
    ['Build server', 'building'], ['Upload tarball to server', 'deploying'], ['Extract, install, migrate, restart', 'deploying']]) {
    assert.equal(deploymentPhase(run({ steps: [{ name, status: 'in_progress', conclusion: null }] }), revision), phase);
  }
  const complete = run({ status: 'completed', conclusion: 'success' });
  assert.equal(deploymentPhase(run({ status: 'completed', conclusion: null }), revision), 'unknown');
  assert.equal(deploymentPhase(complete, null), 'verifying');
  assert.equal(deploymentPhase(complete, 'b'.repeat(40)), 'verifying');
  assert.equal(deploymentPhase(complete, revision), 'success');
  assert.equal(deploymentPhase(run({ status: 'completed', conclusion: 'failure' }), revision), 'failed');
  assert.equal(deploymentPhase(run({ status: 'completed', conclusion: 'cancelled' }), revision), 'canceled');
});

test('many tabs share a cached read; transport failure keeps the last phase and marks it stale', async () => {
  let clock = Date.parse('2026-10-23T12:00:00Z');
  let calls = 0;
  let broken = false;
  const service = new GetDeploymentStatus({
    now: () => new Date(clock), revision: { read: async () => revision },
    source: { latest: async () => { calls++; if (broken) throw Error('private upstream diagnostics'); return run(); } },
  });
  const values = await Promise.all(Array.from({ length: 50 }, () => service.execute()));
  assert.equal(calls, 1);
  assert.ok(values.every(value => value.phase === 'checking' && !value.stale));
  assert.ok(values.every(value => value.deployedRevision === null), 'public readiness is withheld until CI and the installed artifact agree');
  clock += 9999;
  await service.execute(); assert.equal(calls, 1);
  clock += 2; broken = true;
  const stale = await service.execute();
  assert.equal(stale.phase, 'checking'); assert.equal(stale.stale, true);
  assert.doesNotMatch(JSON.stringify(stale), /private upstream/);
  clock += 10001; broken = false;
  assert.equal((await service.execute()).stale, false);
});

test('an unavailable initial source never looks like a successful update', async () => {
  const service = new GetDeploymentStatus({ now: () => new Date(), revision: { read: async () => null },
    source: { latest: async () => { throw Error('missing connection'); } } });
  const status = await service.execute();
  assert.equal(status.phase, 'unknown'); assert.equal(status.stale, true); assert.equal(status.runId, null);
});

test('reload readiness appears only after publication and is withdrawn when verification is unavailable', async () => {
  let clock = Date.parse('2026-10-23T12:00:00Z');
  let complete = false;
  let unavailable = false;
  const service = new GetDeploymentStatus({ now: () => new Date(clock), revision: { read: async () => revision },
    source: { latest: async () => {
      if (unavailable) throw Error('network');
      return complete ? run({ status: 'completed', conclusion: 'success' })
        : run({ steps: [{ name: 'Extract, install, migrate, restart', status: 'in_progress', conclusion: null }] });
    } } });
  assert.equal((await service.execute()).deployedRevision, null, 'copied frontend files are not a completed deployment');
  clock += 10001; complete = true;
  const published = await service.execute();
  assert.equal(published.phase, 'success'); assert.equal(published.deployedRevision, revision);
  clock += 10001; unavailable = true;
  const uncertain = await service.execute();
  assert.equal(uncertain.stale, true); assert.equal(uncertain.deployedRevision, null);
});
