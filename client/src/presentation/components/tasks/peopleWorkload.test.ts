import test from 'node:test';
import assert from 'node:assert/strict';

import { peopleWorkload, workloadLabel } from './peopleWorkload';

const task = (id: string, userId: string, deadline: string | null, status = 'todo') => ({
  id,
  status,
  deadline,
  assignee: { userId },
});

test('counts work and queue regardless of deadline, per assignee', () => {
  const load = peopleWorkload(
    [
      task('a', 'denis', '2026-11-16'),
      task('b', 'denis', '2026-11-17'),
      task('c', 'denis', '2026-11-18'),
      task('d', 'denis', null),
      task('e', 'denis', '2026-11-10', 'done'),
      task('f', 'denis', '2026-11-10', 'pending_approval'),
      task('g', 'oleg', '2026-11-17', 'manual'),
    ],
    '2026-11-17',
  );
  assert.deepEqual(load.get('denis'), { total: 4, late: 1, today: 1 });
  assert.deepEqual(load.get('oleg'), { total: 1, late: 0, today: 1 });
});

test('a task that arrives from two sources is counted once', () => {
  const load = peopleWorkload([task('a', 'vera', '2026-11-01'), task('a', 'vera', '2026-11-01')], '2026-11-17');
  assert.deepEqual(load.get('vera'), { total: 1, late: 1, today: 0 });
});

test('shows the total even without urgent tasks or with an empty workload', () => {
  const load = peopleWorkload([task('a', 'gleb', '2026-12-01')], '2026-11-17');
  assert.equal(workloadLabel(load.get('gleb')), 'В работе и в очереди: 1');
  assert.equal(workloadLabel(undefined), 'В работе и в очереди: 0');
});

test('the label names what burns', () => {
  assert.equal(workloadLabel({ total: 4, late: 2, today: 1 }), 'В работе и в очереди: 4, просрочено 2, на сегодня 1');
  assert.equal(workloadLabel({ total: 3, late: 0, today: 3 }), 'В работе и в очереди: 3, на сегодня 3');
});
