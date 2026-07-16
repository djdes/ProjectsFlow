import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActivityEventItem } from '@/domain/activity/ActivityFeedItem';
import {
  buildProjectChangeAnalytics,
  projectChangeCategories,
  projectChangeTitle,
} from './projectChangeAnalytics';

const now = new Date('2026-07-16T12:00:00.000Z');

function item(
  id: string,
  kind: ActivityEventItem['kind'],
  createdAt: string,
  overrides: Partial<ActivityEventItem> = {},
): ActivityEventItem {
  return {
    type: 'activity',
    id,
    kind,
    createdAt: new Date(createdAt),
    projectId: 'project-1',
    actorUserId: 'user-1',
    actorDisplayName: 'Ярослав',
    actorAvatarUrl: null,
    targetDisplayName: null,
    payload: null,
    ...overrides,
  };
}

test('classifies a multi-field task update into every relevant category', () => {
  const value = item('1', 'task_updated', '2026-07-16T10:00:00.000Z', {
    payload: {
      taskId: 'task-1',
      taskExcerpt: 'Задача',
      changes: [
        { field: 'deadline', old: null, new: '2026-07-20' },
        { field: 'assigneeUserId', old: 'Иван', new: 'Олег' },
        { field: 'description', old: 'Было', new: 'Стало' },
      ],
    },
  });

  assert.deepEqual(projectChangeCategories(value).sort(), [
    'assignee',
    'deadline',
    'description',
  ]);
  assert.equal(projectChangeTitle(value), 'Изменено полей: 3');
});

test('filters the full activity set by period, actor, type and query', () => {
  const source = [
    item('1', 'task_status_changed', '2026-07-16T10:00:00.000Z', {
      payload: { taskId: 'task-1', taskExcerpt: 'Сверить отчёт' },
    }),
    item('2', 'task_updated', '2026-07-15T10:00:00.000Z', {
      actorUserId: 'user-2',
      actorDisplayName: 'Денис',
      payload: {
        taskId: 'task-2',
        taskExcerpt: 'Обновить договор',
        changes: [{ field: 'deadline', old: null, new: '2026-07-20' }],
      },
    }),
    item('3', 'task_updated', '2026-05-01T10:00:00.000Z', {
      payload: {
        taskId: 'task-3',
        taskExcerpt: 'Старая задача',
        changes: [{ field: 'deadline', old: null, new: '2026-05-10' }],
      },
    }),
  ];

  const result = buildProjectChangeAnalytics(
    source,
    {
      windowDays: 28,
      category: 'deadline',
      actorKey: 'user-2',
      query: 'договор',
      sort: 'newest',
    },
    now,
  );

  assert.deepEqual(result.items.map((value) => value.id), ['2']);
  assert.equal(result.taskCount, 1);
  assert.equal(result.actorCount, 1);
  assert.equal(result.fieldChangeCount, 1);
});

test('returns a dense chart range and sorts old changes first on request', () => {
  const source = [
    item('new', 'task_created', '2026-07-16T10:00:00.000Z'),
    item('old', 'task_created', '2026-07-10T10:00:00.000Z'),
  ];
  const result = buildProjectChangeAnalytics(
    source,
    {
      windowDays: 7,
      category: 'all',
      actorKey: 'all',
      query: '',
      sort: 'oldest',
    },
    now,
  );

  assert.deepEqual(result.items.map((value) => value.id), ['old', 'new']);
  assert.equal(result.perDay.length, 7);
  assert.equal(result.todayCount, 1);
});
