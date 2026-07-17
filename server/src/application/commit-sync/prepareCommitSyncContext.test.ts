import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareCommitSyncContext } from './prepareCommitSyncContext.js';

test('commit context asks for a meaningful multi-commit review and keeps author metadata', () => {
  const now = new Date('2026-07-17T14:00:00.000Z'); // Friday 17:00 MSK
  const result = prepareCommitSyncContext({
    tasks: [],
    thresholdHours: 24,
    now,
    commits: [
      {
        sha: 'a'.repeat(40),
        message: 'feat: add payments',
        authorName: 'Anna Dev',
        authorLogin: 'anna-dev',
        authorAvatarUrl: null,
        committedAt: new Date('2026-07-17T10:00:00.000Z'),
        htmlUrl: 'https://github.test/a',
      },
      {
        sha: 'b'.repeat(40),
        message: 'fix: payment retry',
        authorName: 'Boris Dev',
        authorLogin: 'boris-dev',
        authorAvatarUrl: null,
        committedAt: new Date('2026-07-16T20:00:00.000Z'),
        htmlUrl: 'https://github.test/b',
      },
    ],
  });

  assert.match(result.context, /КОММИТЫ ДЛЯ СЕГОДНЯШНЕГО ОБЗОРА/);
  assert.match(result.context, /иногда это один коммит, иногда несколько/);
  assert.match(result.context, /__commit_review__:good\|attention/);
  assert.match(result.context, /__commit_review_summary__/);
  assert.match(result.context, /author=Anna Dev \(@anna-dev\)/);
  assert.equal(result.commits['a'.repeat(40)]?.authorLogin, 'anna-dev');
  assert.equal(result.commits['b'.repeat(40)]?.htmlUrl, 'https://github.test/b');
});

test('Monday review window includes the weekend', () => {
  const now = new Date('2026-07-20T14:00:00.000Z');
  const result = prepareCommitSyncContext({
    tasks: [],
    thresholdHours: 24,
    now,
    commits: [
      {
        sha: 'c'.repeat(40),
        message: 'weekend change',
        authorName: 'Dev',
        authorLogin: null,
        authorAvatarUrl: null,
        committedAt: new Date('2026-07-18T10:00:00.000Z'),
        htmlUrl: 'https://github.test/c',
      },
    ],
  });
  assert.match(result.context, /последние 72 ч/);
  assert.match(result.context, new RegExp(`КОММИТЫ ДЛЯ СЕГОДНЯШНЕГО ОБЗОРА:[\\s\\S]*sha=${'c'.repeat(40)}`));
});
