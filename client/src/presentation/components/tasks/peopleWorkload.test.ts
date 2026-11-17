import test from 'node:test';
import assert from 'node:assert/strict';

import { peopleWorkload, workloadLabel } from './peopleWorkload';

const task = (id: string, userId: string, deadline: string | null, status = 'todo') => ({
  id,
  status,
  deadline,
  assignee: { userId },
});

test('counts only open tasks that are overdue or due today, per assignee', () => {
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
  assert.deepEqual(load.get('denis'), { late: 1, today: 1 });
  assert.deepEqual(load.get('oleg'), { late: 0, today: 1 });
});

test('a task that arrives from two sources is counted once', () => {
  const load = peopleWorkload([task('a', 'vera', '2026-11-01'), task('a', 'vera', '2026-11-01')], '2026-11-17');
  assert.deepEqual(load.get('vera'), { late: 1, today: 0 });
});

test('people with nothing burning have no entry and no label', () => {
  const load = peopleWorkload([task('a', 'gleb', '2026-12-01')], '2026-11-17');
  assert.equal(load.get('gleb'), undefined);
  assert.equal(workloadLabel(undefined), null);
  assert.equal(workloadLabel({ late: 0, today: 0 }), null);
});

test('the label names what burns', () => {
  assert.equal(workloadLabel({ late: 2, today: 1 }), 'просрочено 2, на сегодня 1');
  assert.equal(workloadLabel({ late: 0, today: 3 }), 'на сегодня 3');
});
