import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupAssignedByTime, groupAssignedTasks } from './assignedGrouping';
import type { TaskPriority } from '@/domain/task/Task';
import {
  asAssignedInboxBlockTask,
  buildToMeInboxBlockTasks,
  type AssignedInboxBlockTask,
} from './inboxBlockTasks';

const NOW = new Date(2026, 5, 9, 12, 0, 0);
let seq = 0;

function mk(overrides: {
  projectId?: string;
  projectName?: string;
  isInbox?: boolean;
  createdAt?: Date;
  deadline?: string | null;
  priority?: TaskPriority | null;
  assigneeId?: string;
  assigneeName?: string;
  position?: number;
}): AssignedInboxBlockTask {
  seq += 1;
  return asAssignedInboxBlockTask({
    id: `t-${seq}`,
    projectId: overrides.projectId ?? 'p1',
    assignee: {
      userId: overrides.assigneeId ?? 'me',
      displayName: overrides.assigneeName ?? 'Ярослав',
      avatarUrl: null,
    },
    description: 'desc',
    icon: null,
    cover: null,
    coverPosition: 50,
    status: 'todo',
    statusBeforeDone: null,
    position: overrides.position ?? 0,
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: NOW,
    ralphMode: 'normal',
    ralphCancelRequestedAt: null,
    ralphCancelRequestedBy: null,
    ralphCancelRequestedByDisplayName: null,
    deadline: overrides.deadline ?? null,
    startDate: null,
    parentTaskId: null,
    priority: overrides.priority ?? null,
    projectName: overrides.projectName ?? 'Проект 1',
    isInbox: overrides.isInbox ?? false,
    canModify: true,
  });
}

test('project: группирует по проекту, а Inbox не показывает автора', () => {
  const tasks = [
    mk({ projectId: 'p1', projectName: 'Альфа' }),
    mk({ projectId: 'inbox-other', isInbox: true }),
    mk({ projectId: 'p1', projectName: 'Альфа' }),
  ];
  const groups = groupAssignedTasks(tasks, 'project', NOW);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.key, 'p1');
  assert.equal(groups[0]?.label, 'Альфа');
  assert.equal(groups[0]?.items.length, 2);
  assert.equal(groups[1]?.key, 'inbox');
  assert.equal(groups[1]?.label, 'Личные');
});

test('created: бакеты Сегодня/Вчера/На этой неделе/Ранее, пустые не показываются', () => {
  const tasks = [
    mk({ createdAt: new Date(2026, 5, 1, 9, 0, 0) }),
    mk({ createdAt: new Date(2026, 5, 9, 9, 0, 0) }),
    mk({ createdAt: new Date(2026, 5, 8, 9, 0, 0) }),
    mk({ createdAt: new Date(2026, 5, 5, 9, 0, 0) }),
  ];
  assert.deepEqual(
    groupAssignedTasks(tasks, 'created', NOW).map((group) => group.label),
    ['Сегодня', 'Вчера', 'На этой неделе', 'Ранее'],
  );
});

test('created: внутри бакета новее — выше', () => {
  const older = mk({ createdAt: new Date(2026, 5, 9, 8, 0, 0) });
  const newer = mk({ createdAt: new Date(2026, 5, 9, 11, 0, 0) });
  const groups = groupAssignedTasks([older, newer], 'created', NOW);
  assert.deepEqual(groups[0]?.items.map((task) => task.id), [newer.id, older.id]);
});

test('deadline: сохраняет ожидаемый порядок бакетов', () => {
  const tasks = [
    mk({ deadline: null }),
    mk({ deadline: '2026-07-01' }),
    mk({ deadline: '2026-06-13' }),
    mk({ deadline: '2026-06-10' }),
    mk({ deadline: '2026-06-09' }),
    mk({ deadline: '2026-06-01' }),
  ];
  assert.deepEqual(
    groupAssignedTasks(tasks, 'deadline', NOW).map((group) => group.label),
    ['Просрочено', 'Сегодня', 'Завтра', 'На этой неделе', 'Позже', 'Без дедлайна'],
  );
});

test('priority: сохраняет ожидаемый порядок бакетов', () => {
  const tasks = [
    mk({ priority: null }),
    mk({ priority: 4 }),
    mk({ priority: 2 }),
    mk({ priority: 1 }),
    mk({ priority: 3 }),
  ];
  assert.deepEqual(
    groupAssignedTasks(tasks, 'priority', NOW).map((group) => group.label),
    ['Срочно', 'Высокий', 'Средний', 'Низкий', 'Без приоритета'],
  );
});

test('project, вкладка «Другим»: Inbox-группы дробятся по ответственному', () => {
  const tasks = [
    mk({ projectId: 'inbox', isInbox: true, assigneeId: 'bob', assigneeName: 'Боб' }),
    mk({ projectId: 'inbox', isInbox: true, assigneeId: 'vera', assigneeName: 'Вера' }),
    mk({ projectId: 'p1', projectName: 'Альфа', assigneeId: 'bob', assigneeName: 'Боб' }),
  ];
  const groups = groupAssignedTasks(tasks, 'project', NOW, 'byMe');
  assert.deepEqual(
    groups.map((group) => group.label),
    ['Личные · Боб', 'Личные · Вера', 'Альфа'],
  );
  assert.equal(new Set(groups.map((group) => group.key)).size, 3);
});

test('project: локальное зеркало Inbox остаётся в единой группе «Личные»', () => {
  const boardTask = mk({ projectId: 'inbox', isInbox: true });
  const personal = buildToMeInboxBlockTasks({
    assignedTasks: [],
    boardTasks: [boardTask],
    inboxProjectId: 'inbox',
    owner: { id: 'me', displayName: 'Ярослав' },
  });
  const groups = groupAssignedTasks(personal, 'project', NOW);
  assert.equal(groups[0]?.label, 'Личные');
  assert.equal(groups[0]?.items[0]?.displaySource, 'personal');
});

test('byTime: всегда три колонки, просроченные попадают в «На сегодня»', () => {
  const overdue = mk({ deadline: '2026-06-01' });
  const today = mk({ deadline: '2026-06-09' });
  const noDeadline = mk({ deadline: null });
  const groups = groupAssignedByTime([overdue, today, noDeadline], NOW);
  assert.deepEqual(
    groups.map((group) => ({ key: group.key, label: group.label, count: group.items.length })),
    [
      { key: 'none', label: 'Без срока', count: 1 },
      { key: 'today', label: 'На сегодня', count: 2 },
      { key: 'future', label: 'Будущее', count: 0 },
    ],
  );
});

test('byTime: дедлайн позже сегодня → «Будущее»', () => {
  const future = mk({ deadline: '2026-06-10' });
  const groups = groupAssignedByTime([future], NOW);
  assert.equal(groups[2]?.items[0]?.id, future.id);
});
