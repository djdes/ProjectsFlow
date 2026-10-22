import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notificationTaskTarget, taskCommentFromHash } from './notificationTaskTarget';

test('comment links target the task directly, encode ids and preserve the comment anchor', () => {
  assert.equal(notificationTaskTarget({ projectId: 'project', taskId: 'task', commentId: 'comment' }), '/projects/project/tasks/task#comment-comment');
  const target = notificationTaskTarget({ projectId: 'p/#', taskId: 't ?', commentId: 'c #' });
  assert.equal(target, '/projects/p%2F%23/tasks/t%20%3F#comment-c%20%23');
  assert.equal(taskCommentFromHash('#comment-c%20%23'), 'c #');
  assert.equal(taskCommentFromHash('#comment-%E0'), undefined);
  assert.equal(taskCommentFromHash('#live'), undefined);
  assert.equal(notificationTaskTarget({ projectId: 'p', taskId: 't', taskAvailable: false }), null);
  assert.equal(notificationTaskTarget({ taskId: 't' }), null);
});
