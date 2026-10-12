import assert from 'node:assert/strict';
import test from 'node:test';
import type { InboxBlockTask } from '../inboxBlockTasks';
import { selectInboxView } from './selectInboxView';

const today = '2026-10-12';
const task = (id: string, status: string, deadline: string | null = '2026-10-11') =>
  ({ id, status, deadline } as InboxBlockTask);
const tasks = [task('manual', 'manual'), task('queue1', 'backlog'), task('queue2', 'todo'),
  task('today', 'backlog', today), task('no-date', 'backlog', null), task('done', 'done')];
const approvals = [task('approval', 'pending_approval')];

for (const wide of [false, true]) {
  for (const section of ['now', 'queue'] as const) {
    for (const due of ['late', 'today', 'none'] as const) {
      test(`visible cards equal the ${due} counter: ${wide ? 'desktop' : 'mobile'} ${section}`, () => {
        const view = selectInboxView({ tasks, approvals, today, wide, section, due });
        const visible = wide ? [...view.manual, ...view.approvals, ...view.queue]
          : section === 'now' ? [...view.manual, ...view.approvals] : view.queue;
        assert.equal(visible.length, view.dueCounts[due]);
        assert.ok(!visible.some((item) => item.id === 'done'));
        assert.equal(view.section, section);
      });
    }
  }
}
test('a filter that empties the current section never silently switches to another section', () => {
  const view = selectInboxView({ tasks, approvals, today, wide: false, section: null, due: 'none' });
  assert.equal(view.section, 'now');
  assert.equal(view.manual.length + view.approvals.length, 0);
  assert.equal(view.queue.length, 1);
});
test('an inbox with only queued tasks starts on the queue before filtering', () => {
  const view = selectInboxView({ tasks: tasks.filter((t) => t.status !== 'manual'), approvals: [],
    today, wide: false, section: null, due: 'today' });
  assert.equal(view.section, 'queue');
  assert.deepEqual(view.queue.map((t) => t.id), ['today']);
});
test('without the deadline filter completed cards remain visible when requested by the caller', () => {
  const view = selectInboxView({ tasks, approvals, today, wide: false, section: 'queue', due: null });
  assert.ok(view.queue.some((t) => t.id === 'done'));
  assert.equal(view.dueCounts.late, 2);
});
