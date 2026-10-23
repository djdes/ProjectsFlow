import assert from 'node:assert/strict';
import { test } from 'node:test';
import { taskWorkerActivities, type WorkerActivityComment, type WorkerActivitySession } from './TaskWorkerActivity.js';

const question = (taskId: string, at = 20): WorkerActivityComment => ({ taskId, id: `comment-${taskId}`, actorKind: 'agent', body: '<!-- ralph-question {"id":"same-q","options":["Да","Нет"]} -->\nНужен ответ', createdAt: new Date(at) });
const answer = (taskId: string, at = 30): WorkerActivityComment => ({ taskId, id: `answer-${taskId}`, actorKind: 'user', body: '<!-- ralph-answer {"q":"same-q","value":"Да"} -->', createdAt: new Date(at) });
const session = (taskId: string, status: string, startedAt = 10): WorkerActivitySession => ({ taskId, id: `session-${taskId}`, status, startedAt: new Date(startedAt), endedAt: status === 'running' ? null : new Date(startedAt + 5) });

test('pending dispatcher question appears without a LIVE run; answers are isolated by task and creation time', () => {
  const rows = taskWorkerActivities([], [question('one'), question('two'), answer('one')]);
  assert.deepEqual(rows, [{ taskId: 'two', state: 'question', sessionId: null, questionCommentId: 'comment-two' }]);
  assert.equal(taskWorkerActivities([], [answer('one'), question('one', 40)])[0]!.state, 'question');
});

test('only trusted questions and human answers count; malformed markers are ignored', () => {
  assert.deepEqual(taskWorkerActivities([], [{ ...question('one'), actorKind: 'user' }]), []);
  assert.equal(taskWorkerActivities([], [question('one'), { ...answer('one'), actorKind: 'agent' }])[0]!.state, 'question');
  assert.deepEqual(taskWorkerActivities([], [{ ...question('one'), body: '<!-- ralph-question broken-json -->' }]), []);
});

test('latest final failure/timeout requires attention; successful and cancelled runs do not', () => {
  assert.deepEqual(taskWorkerActivities([session('one', 'failed'), session('two', 'timeout'), session('three', 'completed'), session('four', 'canceled')], []).map(r => [r.taskId, r.state]), [['one', 'error'], ['two', 'error']]);
  assert.equal(taskWorkerActivities([session('one', 'running')], [question('one')])[0]!.state, 'question');
  assert.equal(taskWorkerActivities([session('one', 'failed')], [question('one')])[0]!.state, 'question');
});

test('a new run or successful completion supersedes stale questions; later questions remain visible', () => {
  assert.equal(taskWorkerActivities([session('one', 'running', 40)], [question('one')])[0]!.state, 'running');
  assert.deepEqual(taskWorkerActivities([session('one', 'completed', 10)], [question('one', 12)]), []);
  assert.equal(taskWorkerActivities([session('one', 'completed', 10)], [question('one', 20)])[0]!.state, 'question');
  assert.deepEqual(taskWorkerActivities([session('one', 'canceled', 10)], [question('one', 12)]), []);
});
