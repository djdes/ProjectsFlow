import assert from 'node:assert/strict';
import { test } from 'node:test';
import { taskWorkerActivities, type WorkerActivityComment, type WorkerActivitySession } from './TaskWorkerActivity.js';

const question = (taskId: string, at = 20): WorkerActivityComment => ({ taskId, id: `comment-${taskId}`, actorKind: 'agent', body: '<!-- ralph-question {"id":"same-q","options":["Да","Нет"]} -->\nНужен ответ', createdAt: new Date(at) });
const answer = (taskId: string, at = 30): WorkerActivityComment => ({ taskId, id: `answer-${taskId}`, actorKind: 'user', body: '<!-- ralph-answer {"q":"same-q","value":"Да"} -->', createdAt: new Date(at) });
const cancel = (taskId: string, at = 30): WorkerActivityComment => ({ taskId, id: `cancel-${taskId}`, actorKind: 'agent', body: '<!-- ralph-clarify-cancel {"v":1,"q":"same-q","reason":"resumed"} -->', createdAt: new Date(at) });
const session = (taskId: string, status: string, startedAt = 10, endedAt?: number | null, taskStatus?: string): WorkerActivitySession => ({
  taskId,
  id: `session-${taskId}-${startedAt}`,
  status,
  startedAt: new Date(startedAt),
  endedAt: endedAt !== undefined ? (endedAt === null ? null : new Date(endedAt)) : (status === 'running' ? null : new Date(startedAt + 5)),
  taskStatus,
});

test('pending dispatcher question appears without a LIVE run; answers and cancellations clear it', () => {
  const rows = taskWorkerActivities([], [question('one'), question('two'), answer('one')]);
  assert.deepEqual(rows, [{ taskId: 'two', state: 'question', sessionId: null, questionCommentId: 'comment-two' }]);
  assert.equal(taskWorkerActivities([], [answer('one'), question('one', 40)])[0]!.state, 'question');
  assert.deepEqual(taskWorkerActivities([], [question('one'), cancel('one')]), []);
});

test('only trusted questions and human answers count; malformed markers are ignored', () => {
  assert.deepEqual(taskWorkerActivities([], [{ ...question('one'), actorKind: 'user' }]), []);
  assert.equal(taskWorkerActivities([], [question('one'), { ...answer('one'), actorKind: 'agent' }])[0]!.state, 'question');
  assert.equal(taskWorkerActivities([], [question('one'), { ...cancel('one'), actorKind: 'user' }])[0]!.state, 'question');
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

test('overlapping session completed later beats duplicate collision failed earlier; pending_approval suppresses error badge', () => {
  const completedMain = session('one', 'completed', 100, 700, 'pending_approval');
  const duplicateCollision = session('one', 'failed', 120, 126, 'pending_approval');
  assert.deepEqual(taskWorkerActivities([completedMain, duplicateCollision], []), []);
  assert.deepEqual(taskWorkerActivities([duplicateCollision, completedMain], []), []);
  assert.deepEqual(taskWorkerActivities([session('approval', 'failed', 100, 105, 'pending_approval')], []), []);
  assert.equal(taskWorkerActivities([session('approval', 'running', 100, null, 'pending_approval')], [])[0]!.state, 'running');
});

test('newer finished session supersedes an older orphaned running session regardless of order', () => {
  const staleRunning = session('one', 'running', 100, null, 'pending_approval');
  const newerCompleted = session('one', 'completed', 200, 700, 'pending_approval');
  assert.deepEqual(taskWorkerActivities([staleRunning, newerCompleted], []), []);
  assert.deepEqual(taskWorkerActivities([newerCompleted, staleRunning], []), []);
});
