import test from 'node:test';
import assert from 'node:assert/strict';
import { fromDto, type TaskDto } from './HttpTaskRepository';

test('run mode: DTO без поля (старый backend) читается как quick', () => {
  const base = {
    id: 't1', projectId: 'p1', description: 'x', status: 'todo', position: 1,
    assignee: { userId: 'u1', displayName: 'U' },
    createdAt: '2026-11-18T10:00:00.000Z', updatedAt: '2026-11-18T10:00:00.000Z',
  } as unknown as TaskDto;
  assert.equal(fromDto(base).runMode, 'quick');
  assert.equal(fromDto({ ...base, runMode: 'full' }).runMode, 'full');
});
