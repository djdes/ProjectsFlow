import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AssignedTask } from '@/domain/task/AssignedTask';
import { workspaceInboxPreview } from './workspaceInboxPreview';

function task(id: string, overrides: Partial<AssignedTask> = {}): AssignedTask {
  return {
    id,
    projectId: 'p1',
    projectName: 'Проект',
    isInbox: false,
    canModify: true,
    assignee: { userId: 'me', displayName: 'Я', avatarUrl: null },
    description: id,
    icon: null,
    cover: null,
    coverPosition: 50,
    status: 'backlog',
    statusBeforeDone: null,
    position: 0,
    createdAt: new Date('2026-10-01T09:00:00.000Z'),
    updatedAt: new Date('2026-10-01T09:00:00.000Z'),
    ralphMode: 'normal',
    ralphCancelRequestedAt: null,
    ralphCancelRequestedBy: null,
    ralphCancelRequestedByDisplayName: null,
    deadline: null,
    startDate: null,
    parentTaskId: null,
    priority: null,
    taskType: null,
    ...overrides,
  };
}

test('preview drops done tasks and puts the nearest deadline first, undated newest after', () => {
  const preview = workspaceInboxPreview([
    task('undated-old', { createdAt: new Date('2026-09-01T00:00:00.000Z') }),
    task('done', { status: 'done', deadline: '2026-01-01' }),
    task('later', { deadline: '2026-11-10' }),
    task('undated-new', { createdAt: new Date('2026-10-20T00:00:00.000Z') }),
    task('overdue', { deadline: '2026-10-01', status: 'manual' }),
  ]);
  assert.deepEqual(preview.items.map((t) => t.id), ['overdue', 'later', 'undated-new', 'undated-old']);
  assert.equal(preview.total, 4);
});

test('preview caps the list and keeps the full open count', () => {
  const preview = workspaceInboxPreview(Array.from({ length: 8 }, (_, i) => task(`t${i}`)), 5);
  assert.equal(preview.items.length, 5);
  assert.equal(preview.total, 8);
});
