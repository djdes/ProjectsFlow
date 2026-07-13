import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupAssignedByTime, groupAssignedTasks } from './assignedGrouping';
import type { AssignedTask } from '@/domain/task/AssignedTask';
import type { TaskDelegation, TaskDelegationStatus } from '@/domain/task/TaskDelegation';
import type { TaskPriority } from '@/domain/task/Task';

// Фикс «сейчас» — вторник, 9 июня 2026, локальный полдень.
const NOW = new Date(2026, 5, 9, 12, 0, 0);

let seq = 0;

function mk(overrides: {
  projectId?: string;
  projectName?: string;
  isInbox?: boolean;
  createdAt?: Date;
  deadline?: string | null;
  priority?: TaskPriority | null;
  status?: TaskDelegationStatus;
  creator?: string;
  // Имя делегата (id выводится из имени) — для направления «Другим».
  delegate?: string;
  position?: number;
}): AssignedTask {
  seq += 1;
  const id = `t-${seq}`;
  const delegation: TaskDelegation = {
    id: `d-${seq}`,
    taskId: id,
    delegateUserId: overrides.delegate ?? 'me',
    delegateDisplayName: overrides.delegate ?? 'Me',
    creatorUserId: 'creator',
    creatorDisplayName: overrides.creator ?? 'Алиса',
    status: overrides.status ?? 'accepted',
    createdAt: overrides.createdAt ?? NOW,
    respondedAt: null,
  };
  return {
    id,
    projectId: overrides.projectId ?? 'p1',
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
    delegation,
    projectName: overrides.projectName ?? 'Проект 1',
    isInbox: overrides.isInbox ?? false,
    canModify: true,
  };
}

test('project: группирует по проекту в порядке первого появления, inbox → «Личные · автор»', () => {
  const tasks = [
    mk({ projectId: 'p1', projectName: 'Альфа' }),
    mk({ projectId: 'inbox', isInbox: true, creator: 'Боб' }),
    mk({ projectId: 'p1', projectName: 'Альфа' }),
  ];
  const groups = groupAssignedTasks(tasks, 'project', NOW);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.key, 'p1');
  assert.equal(groups[0]?.label, 'Альфа');
  assert.equal(groups[0]?.items.length, 2);
  assert.equal(groups[1]?.key, 'inbox');
  assert.equal(groups[1]?.label, 'Личные · Боб');
  assert.equal(groups[1]?.isInbox, true);
});

test('created: бакеты Сегодня/Вчера/На этой неделе/Ранее, пустые не показываются', () => {
  const tasks = [
    mk({ createdAt: new Date(2026, 5, 1, 9, 0, 0) }), // 8 дней назад → Ранее
    mk({ createdAt: new Date(2026, 5, 9, 9, 0, 0) }), // сегодня
    mk({ createdAt: new Date(2026, 5, 8, 9, 0, 0) }), // вчера
    mk({ createdAt: new Date(2026, 5, 5, 9, 0, 0) }), // 4 дня назад → на этой неделе
  ];
  const groups = groupAssignedTasks(tasks, 'created', NOW);
  assert.deepEqual(
    groups.map((g) => g.label),
    ['Сегодня', 'Вчера', 'На этой неделе', 'Ранее'],
  );
  assert.equal(groups.every((g) => g.items.length === 1), true);
});

test('created: внутри бакета новее — выше', () => {
  const older = mk({ createdAt: new Date(2026, 5, 9, 8, 0, 0) });
  const newer = mk({ createdAt: new Date(2026, 5, 9, 11, 0, 0) });
  const groups = groupAssignedTasks([older, newer], 'created', NOW);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.items[0]?.id, newer.id);
  assert.equal(groups[0]?.items[1]?.id, older.id);
});

test('deadline: порядок Просрочено/Сегодня/Завтра/На этой неделе/Позже/Без дедлайна', () => {
  const tasks = [
    mk({ deadline: null }),
    mk({ deadline: '2026-07-01' }), // позже
    mk({ deadline: '2026-06-13' }), // в пределах недели
    mk({ deadline: '2026-06-10' }), // завтра
    mk({ deadline: '2026-06-09' }), // сегодня
    mk({ deadline: '2026-06-01' }), // просрочено
  ];
  const groups = groupAssignedTasks(tasks, 'deadline', NOW);
  assert.deepEqual(
    groups.map((g) => g.label),
    ['Просрочено', 'Сегодня', 'Завтра', 'На этой неделе', 'Позже', 'Без дедлайна'],
  );
});

test('priority: порядок Срочно/Высокий/Средний/Низкий/Без приоритета', () => {
  const tasks = [
    mk({ priority: null }),
    mk({ priority: 4 }),
    mk({ priority: 2 }),
    mk({ priority: 1 }),
    mk({ priority: 3 }),
  ];
  const groups = groupAssignedTasks(tasks, 'priority', NOW);
  assert.deepEqual(
    groups.map((g) => g.label),
    ['Срочно', 'Высокий', 'Средний', 'Низкий', 'Без приоритета'],
  );
});

test('project, направление «Другим»: inbox-группы дробятся по делегату («Личные · кому»)', () => {
  const tasks = [
    mk({ projectId: 'inbox', isInbox: true, delegate: 'Боб' }),
    mk({ projectId: 'inbox', isInbox: true, delegate: 'Вера' }),
    mk({ projectId: 'p1', projectName: 'Альфа', delegate: 'Боб' }),
  ];
  const groups = groupAssignedTasks(tasks, 'project', NOW, 'byMe');
  assert.deepEqual(
    groups.map((g) => g.label),
    ['Личные · Боб', 'Личные · Вера', 'Альфа'],
  );
  // Ключи inbox-групп уникальны по человеку (не схлопываются в один projectId).
  assert.equal(new Set(groups.map((g) => g.key)).size, 3);
});

test('byTime: всегда ровно 3 колонки (даже пустые), просроченные попадают в «На сегодня»', () => {
  const overdue = mk({ deadline: '2026-06-01' }); // дедлайн в прошлом
  const today = mk({ deadline: '2026-06-09' }); // сегодня
  const noDeadline = mk({ deadline: null });
  const groups = groupAssignedByTime([overdue, today, noDeadline], NOW);
  assert.deepEqual(
    groups.map((g) => ({ key: g.key, label: g.label, count: g.items.length })),
    [
      { key: 'none', label: 'Без срока', count: 1 },
      { key: 'today', label: 'На сегодня', count: 2 },
      { key: 'future', label: 'Будущее', count: 0 },
    ],
  );
  // Просроченная и сегодняшняя — обе в «На сегодня»; внутри порядок по дедлайну (старее выше).
  assert.deepEqual(
    groups[1]?.items.map((t) => t.id),
    [overdue.id, today.id],
  );
});

test('byTime: дедлайн позже сегодня → «Будущее»', () => {
  const future = mk({ deadline: '2026-06-10' }); // завтра
  const groups = groupAssignedByTime([future], NOW);
  assert.equal(groups[2]?.items[0]?.id, future.id);
  assert.equal(groups[0]?.items.length, 0);
  assert.equal(groups[1]?.items.length, 0);
});
