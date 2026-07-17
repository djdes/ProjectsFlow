import assert from 'node:assert/strict';
import test from 'node:test';
import { extractEmbeddedReview } from './CompleteCommitSyncJob.js';

test('legacy MCP matches carry selected reviews and the overall summary', () => {
  assert.deepEqual(
    extractEmbeddedReview([
      { taskId: 'real-task', commitSha: 'a', reason: 'task match' },
      {
        taskId: '__commit_review__:attention',
        commitSha: 'b',
        reason: 'Нужно проверить миграцию.',
      },
      {
        taskId: '__commit_review__:good',
        commitSha: 'c',
        reason: 'Изменение выглядит аккуратно.',
      },
      {
        taskId: '__commit_review_summary__',
        commitSha: '-',
        reason: 'Один коммит требует внимания.',
      },
    ]),
    {
      reviews: [
        { commitSha: 'b', verdict: 'attention', summary: 'Нужно проверить миграцию.' },
        { commitSha: 'c', verdict: 'good', summary: 'Изменение выглядит аккуратно.' },
      ],
      overallSummary: 'Один коммит требует внимания.',
    },
  );
});
