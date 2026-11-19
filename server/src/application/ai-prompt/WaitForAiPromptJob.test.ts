import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WaitForAiPromptJob } from './WaitForAiPromptJob.js';
import type { AiPromptJob } from '../../domain/ai-prompt/AiPromptJob.js';

function job(status: AiPromptJob['status']): AiPromptJob {
  const at = new Date(0);
  return {
    id: 'job-1', createdBy: 'u1', projectId: null, dispatcherUserId: 'd1', status, mode: 'text',
    inputText: '{}', kbContext: null, improvedText: status === 'succeeded' ? 'ok' : null, error: null,
    claimedAt: null, finishedAt: null, createdAt: at, updatedAt: at,
  };
}

function useCase(current: AiPromptJob) {
  return new WaitForAiPromptJob({
    aiPromptJobs: { findById: async () => current } as never,
    isAdmin: async () => false,
  });
}

test('wait=0: без флага незавершённый job → null (контракт 504 для старых роутов)', async () => {
  assert.equal(await useCase(job('running')).execute({ userId: 'u1', jobId: 'job-1', maxWaitMs: 0 }), null);
});

test('wait=0 + returnLatestOnTimeout: отдаёт текущий снимок', async () => {
  const result = await useCase(job('running')).execute({ userId: 'u1', jobId: 'job-1', maxWaitMs: 0, returnLatestOnTimeout: true });
  assert.equal(result?.status, 'running');
});

test('терминальный job отдаётся сразу, чужой — ошибка доступа', async () => {
  assert.equal((await useCase(job('succeeded')).execute({ userId: 'u1', jobId: 'job-1', maxWaitMs: 0 }))?.improvedText, 'ok');
  await assert.rejects(() => useCase(job('queued')).execute({ userId: 'u2', jobId: 'job-1', maxWaitMs: 0 }));
});
