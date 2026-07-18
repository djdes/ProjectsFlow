import assert from 'node:assert/strict';
import test from 'node:test';
import type { SiteEditorAiJob } from '@/application/site-editor/SiteEditorRepository';
import { HttpError } from '@/lib/HttpError';
import {
  pollSiteEditorAiJob,
  SiteEditorAiSubmissionCoordinator,
  siteEditorAiErrorMessage,
} from './aiJobSubmission';

test('AI submission acknowledges synchronously and starts heavy work asynchronously only once', async () => {
  const coordinator = new SiteEditorAiSubmissionCoordinator(() => 'preview-ai-fixed');
  let calls = 0;
  const first = coordinator.start(async (key) => {
    calls += 1;
    assert.equal(key, 'preview-ai-fixed');
    return 'done';
  });
  const duplicate = coordinator.start(async () => 'duplicate');

  assert.equal(first.accepted, true);
  assert.equal(duplicate.accepted, false);
  assert.equal(calls, 0, 'network work must not start in the click stack');
  if (!first.accepted) throw new Error('submission was unexpectedly rejected');
  assert.equal(await first.completion, 'done');
  assert.equal(calls, 1);
});

test('AI polling reports every state and returns the terminal job', async () => {
  const states: SiteEditorAiJob[] = [
    { id: 'job-1', status: 'running', message: 'working' },
    { id: 'job-1', status: 'completed', message: 'done' },
  ];
  const seen: string[] = [];
  const result = await pollSiteEditorAiJob({ id: 'job-1', status: 'queued' }, {
    signal: new AbortController().signal,
    load: async () => states.shift() as SiteEditorAiJob,
    onProgress: (job) => seen.push(job.status),
    wait: async () => undefined,
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(seen, ['queued', 'running', 'completed']);
});

test('AI errors explain actionable server states', () => {
  assert.match(
    siteEditorAiErrorMessage(new HttpError(409, { error: 'dispatcher_not_configured' })),
    /диспетчер/u,
  );
  assert.match(
    siteEditorAiErrorMessage(new HttpError(409, { error: 'site_not_deployed' })),
    /запустите проект/u,
  );
});
