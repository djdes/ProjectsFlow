import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultCommentAudience } from './defaultCommentAudience';

test('new comments select only the assignee, excluding self and missing identities', () => {
  assert.deepEqual(defaultCommentAudience('executor', 'author'), { mode: 'selected', userIds: ['executor'] });
  assert.deepEqual(defaultCommentAudience('author', 'author'), { mode: 'none' });
  assert.deepEqual(defaultCommentAudience(null, 'author'), { mode: 'none' });
  assert.deepEqual(defaultCommentAudience('executor', null), { mode: 'none' });
});
