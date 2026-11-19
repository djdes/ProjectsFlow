import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultCommentAudience } from './defaultCommentAudience';
import type { CommentNotifyCandidate } from './TaskComment';

function candidate(userId: string, isDefault: boolean): CommentNotifyCandidate {
  return { userId, displayName: userId, avatarUrl: null, isDefault, isManager: isDefault };
}

test('before candidates load, the assignee is selected, excluding self and missing identities', () => {
  assert.deepEqual(defaultCommentAudience(null, 'executor', 'author'), { mode: 'selected', userIds: ['executor'] });
  assert.deepEqual(defaultCommentAudience(null, 'author', 'author'), { mode: 'none' });
  assert.deepEqual(defaultCommentAudience(null, null, 'author'), { mode: 'none' });
  assert.deepEqual(defaultCommentAudience(null, 'executor', null), { mode: 'none' });
});

test('loaded candidates select the server defaults (the manager)', () => {
  assert.deepEqual(
    defaultCommentAudience([candidate('lead', true), candidate('dev', false)], 'author', 'author'),
    { mode: 'selected', userIds: ['lead'] },
  );
});

test('loaded candidates without defaults notify nobody', () => {
  assert.deepEqual(defaultCommentAudience([candidate('dev', false)], 'dev', 'author'), { mode: 'none' });
  assert.deepEqual(defaultCommentAudience([], 'author', 'author'), { mode: 'none' });
});
