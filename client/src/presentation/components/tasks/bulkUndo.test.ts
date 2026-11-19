import test from 'node:test';
import assert from 'node:assert/strict';

import type { BulkTaskActions } from '@/presentation/hooks/useBulkTaskActions';
import { groupByPrevious, undoBulk, type BulkTaskSnapshot } from './bulkUndo';

const snap = (patch: Partial<BulkTaskSnapshot>): BulkTaskSnapshot => ({
  status: 'todo',
  priority: null,
  deadline: null,
  assigneeUserId: 'anna',
  projectId: 'p1',
  ralphMode: 'normal' as BulkTaskSnapshot['ralphMode'],
  ...patch,
});

function recordingBulk(): { bulk: BulkTaskActions; calls: Array<[string, string[], unknown]> } {
  const calls: Array<[string, string[], unknown]> = [];
  const rec = (name: string) => async (ids: string[], value: unknown) => {
    calls.push([name, ids, value]);
    return { ok: ids.length, failed: 0 };
  };
  const bulk = {
    assign: rec('assign'),
    setDeadline: rec('setDeadline'),
    setPriority: rec('setPriority'),
    moveToColumn: rec('moveToColumn'),
    moveToProject: rec('moveToProject'),
    setRalphMode: rec('setRalphMode'),
    remove: async () => ({ ok: 0, failed: 0 }),
  } as unknown as BulkTaskActions;
  return { bulk, calls };
}

test('ids are grouped by their previous value, null included', () => {
  const groups = groupByPrevious(
    new Map([
      ['a', snap({ deadline: '2026-11-17' })],
      ['b', snap({ deadline: null })],
      ['c', snap({ deadline: '2026-11-17' })],
    ]),
    (s) => s.deadline,
  );
  assert.deepEqual([...groups], [['2026-11-17', ['a', 'c']], [null, ['b']]]);
});

test('undo of a bulk reassignment gives every task back to its previous assignee', async () => {
  const { bulk, calls } = recordingBulk();
  const result = await undoBulk(
    'assign',
    new Map([
      ['a', snap({ assigneeUserId: 'denis' })],
      ['b', snap({ assigneeUserId: 'oleg' })],
      ['c', snap({ assigneeUserId: 'denis' })],
    ]),
    bulk,
  );
  assert.deepEqual(calls, [
    ['assign', ['a', 'c'], 'denis'],
    ['assign', ['b'], 'oleg'],
  ]);
  assert.deepEqual(result, { ok: 3, failed: 0 });
});

test('undo of a column move restores each status; of a project move — each project', async () => {
  const { bulk, calls } = recordingBulk();
  const snapshot = new Map([
    ['a', snap({ status: 'backlog', projectId: 'p1' })],
    ['b', snap({ status: 'todo', projectId: 'p2' })],
  ]);
  await undoBulk('column', snapshot, bulk);
  await undoBulk('project', snapshot, bulk);
  assert.deepEqual(calls, [
    ['moveToColumn', ['a'], 'backlog'],
    ['moveToColumn', ['b'], 'todo'],
    ['moveToProject', ['a'], 'p1'],
    ['moveToProject', ['b'], 'p2'],
  ]);
});
