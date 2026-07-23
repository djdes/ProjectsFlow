import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareCommitSyncContext } from './prepareCommitSyncContext.js';

test('commit context asks only to match drafts with commits — no significance review', () => {
  const now = new Date('2026-07-17T14:00:00.000Z'); // Friday 17:00 MSK
  const result = prepareCommitSyncContext({
    tasks: [{ id: 't1', description: 'Экспорт заказов\nдетали', status: 'backlog' } as never],
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
    ],
  });

  // Только сопоставление задача↔коммит.
  assert.match(result.context, /Сопоставь задачи-черновики/);
  assert.match(result.context, /ЗАДАЧИ \(колонка «Черновики»\)/);
  assert.match(result.context, /taskId=t1/);
  assert.match(result.context, /author=Anna Dev \(@anna-dev\)/);
  // Разбора коммитов на значимость больше нет.
  assert.doesNotMatch(result.context, /__commit_review/);
  assert.doesNotMatch(result.context, /verdict/);
  assert.doesNotMatch(result.context, /обзор/i);
  // Снапшот коммитов сохраняется — нужен на этапе complete для защиты от галлюцинированного sha.
  assert.equal(result.commits['a'.repeat(40)]?.authorLogin, 'anna-dev');
  assert.equal(result.commits['a'.repeat(40)]?.htmlUrl, 'https://github.test/a');
});

test('commit context lists commits for matching and marks the empty draft column', () => {
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
  assert.match(result.context, new RegExp(`КОММИТЫ:[\\s\\S]*sha=${'c'.repeat(40)}`));
  assert.match(result.context, /черновиков нет/);
});
