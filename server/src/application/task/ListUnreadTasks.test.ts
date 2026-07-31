import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ListUnreadTasks, UNREAD_WINDOW_DAYS } from './ListUnreadTasks.js';

const NOW = new Date('2026-07-31T12:00:00.000Z');

function make() {
  const calls: { userId: string; since: Date }[] = [];
  const uc = new ListUnreadTasks({
    views: {
      listUnreadAssignedTaskIds: async (userId: string, since: Date) => {
        calls.push({ userId, since });
        return ['t1', 't2'];
      },
    } as never,
  });
  return { uc, calls };
}

test('окно непрочитанного отсчитывается от «сейчас» назад', async () => {
  const h = make();

  const ids = await h.uc.execute('me', NOW);

  assert.deepEqual(ids, ['t1', 't2']);
  assert.equal(h.calls[0]?.userId, 'me');
  const expected = new Date(NOW.getTime() - UNREAD_WINDOW_DAYS * 24 * 3600_000);
  assert.equal(h.calls[0]?.since.toISOString(), expected.toISOString());
});

test('окно не бесконечное — иначе на раскатке подсветилась бы вся история', () => {
  assert.ok(UNREAD_WINDOW_DAYS > 0 && UNREAD_WINDOW_DAYS <= 30);
});
