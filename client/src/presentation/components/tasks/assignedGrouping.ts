import type { AssignedTask } from '@/domain/task/AssignedTask';
import type { AssignedGrouping } from '@/domain/user/UiPrefs';

// Группа для рендера блока «Поручено мне». В отличие от прежней доменной AssignedGroup
// (всегда по проекту) — это результат произвольной группировки (проект/дата/дедлайн/
// приоритет). `key` — стабильный React-key и id бакета; `isInbox` важен только для
// project-режима (выбор иконки заголовка), иначе false.
export type AssignedDisplayGroup = {
  readonly key: string;
  readonly label: string;
  readonly isInbox: boolean;
  readonly items: AssignedTask[];
};

// Направление делегирования: 'toMe' — задачи, порученные мне; 'byMe' — порученные мной.
// Влияет только на project-группировку inbox-задач (чьим именем подписывать «Личные»).
export type DelegationDirection = 'toMe' | 'byMe';

// Чистая функция группировки — вся логика бакетов здесь (тестируется без React/DOM).
// `now` передаётся явно, чтобы границы дней («сегодня/вчера/неделя») были детерминированы.
export function groupAssignedTasks(
  tasks: readonly AssignedTask[],
  mode: AssignedGrouping,
  now: Date,
  direction: DelegationDirection = 'toMe',
): AssignedDisplayGroup[] {
  switch (mode) {
    case 'created':
      return groupByCreated(tasks, now);
    case 'deadline':
      return groupByDeadline(tasks, now);
    case 'priority':
      return groupByPriority(tasks);
    case 'project':
    default:
      return groupByProject(tasks, direction);
  }
}

// pending (ожидают «Принять») всегда поднимаются над принятыми — требуют действия.
function pendingScore(t: AssignedTask): number {
  return t.delegation.status === 'pending' ? 1 : 0;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// Локальная дата YYYY-MM-DD — для лексикографического (= хронологического) сравнения
// со строковыми task.deadline.
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function groupByProject(
  tasks: readonly AssignedTask[],
  direction: DelegationDirection,
): AssignedDisplayGroup[] {
  const map = new Map<string, AssignedDisplayGroup>();
  for (const t of tasks) {
    // Inbox-задачи: в «Для меня» это чужие инбоксы — группа на делегатора («Личные ·
    // <кто поручил>»); в «Другим» инбокс один (свой), подпись своим именем бессмысленна —
    // группируем по делегату («Личные · <кому поручено>»), ключ дробится по человеку.
    const key =
      t.isInbox && direction === 'byMe'
        ? `${t.projectId}:${t.delegation.delegateUserId}`
        : t.projectId;
    let g = map.get(key);
    if (!g) {
      const label = t.isInbox
        ? `Личные · ${
            direction === 'byMe'
              ? t.delegation.delegateDisplayName
              : t.delegation.creatorDisplayName
          }`
        : t.projectName;
      g = { key, label, isInbox: t.isInbox, items: [] };
      map.set(key, g);
    }
    g.items.push(t);
  }
  const groups = [...map.values()];
  for (const g of groups) g.items.sort((a, b) => pendingScore(b) - pendingScore(a));
  return groups;
}

// Универсальный сборщик для режимов с фиксированным набором бакетов: раскладывает задачи
// по ключам, сортирует внутри и отдаёт непустые бакеты в порядке `defs`.
function buildFixed(
  tasks: readonly AssignedTask[],
  defs: readonly { key: string; label: string }[],
  bucketOf: (t: AssignedTask) => string,
  within: (a: AssignedTask, b: AssignedTask) => number,
): AssignedDisplayGroup[] {
  const byKey = new Map<string, AssignedTask[]>();
  for (const t of tasks) {
    const k = bucketOf(t);
    const arr = byKey.get(k);
    if (arr) arr.push(t);
    else byKey.set(k, [t]);
  }
  const out: AssignedDisplayGroup[] = [];
  for (const d of defs) {
    const items = byKey.get(d.key);
    if (!items || items.length === 0) continue;
    items.sort(within);
    out.push({ key: d.key, label: d.label, isInbox: false, items });
  }
  return out;
}

function groupByCreated(tasks: readonly AssignedTask[], now: Date): AssignedDisplayGroup[] {
  const sod = startOfDay(now);
  const tToday = sod.getTime();
  const tYesterday = addDays(sod, -1).getTime();
  const tWeek = addDays(sod, -7).getTime();
  const bucketOf = (t: AssignedTask): string => {
    const x = t.createdAt.getTime();
    if (x >= tToday) return 'today';
    if (x >= tYesterday) return 'yesterday';
    if (x >= tWeek) return 'week';
    return 'earlier';
  };
  const within = (a: AssignedTask, b: AssignedTask): number =>
    pendingScore(b) - pendingScore(a) || b.createdAt.getTime() - a.createdAt.getTime();
  return buildFixed(
    tasks,
    [
      { key: 'today', label: 'Сегодня' },
      { key: 'yesterday', label: 'Вчера' },
      { key: 'week', label: 'На этой неделе' },
      { key: 'earlier', label: 'Ранее' },
    ],
    bucketOf,
    within,
  );
}

function groupByDeadline(tasks: readonly AssignedTask[], now: Date): AssignedDisplayGroup[] {
  const sod = startOfDay(now);
  const today = ymd(sod);
  const tomorrow = ymd(addDays(sod, 1));
  const weekEnd = ymd(addDays(sod, 7));
  const bucketOf = (t: AssignedTask): string => {
    const d = t.deadline;
    if (d === null) return 'none';
    if (d < today) return 'overdue';
    if (d === today) return 'today';
    if (d === tomorrow) return 'tomorrow';
    if (d <= weekEnd) return 'week';
    return 'later';
  };
  const within = (a: AssignedTask, b: AssignedTask): number =>
    pendingScore(b) - pendingScore(a) || (a.deadline ?? '').localeCompare(b.deadline ?? '');
  return buildFixed(
    tasks,
    [
      { key: 'overdue', label: 'Просрочено' },
      { key: 'today', label: 'Сегодня' },
      { key: 'tomorrow', label: 'Завтра' },
      { key: 'week', label: 'На этой неделе' },
      { key: 'later', label: 'Позже' },
      { key: 'none', label: 'Без дедлайна' },
    ],
    bucketOf,
    within,
  );
}

// Канбан «Поручено мне» по ВРЕМЕНИ: РОВНО 3 колонки, всегда все три (даже пустые — как
// колонки доски проекта). Бакет по дедлайну: нет дедлайна → «Без срока»; дедлайн сегодня или
// раньше (включая просроченные) → «На сегодня»; дедлайн позже сегодня → «Будущее». `key` бакета
// ('none'/'today'/'future') используется в UI для выбора иконки колонки.
export function groupAssignedByTime(
  tasks: readonly AssignedTask[],
  now: Date,
): AssignedDisplayGroup[] {
  const today = ymd(startOfDay(now));
  const bucketOf = (t: AssignedTask): 'none' | 'today' | 'future' => {
    const d = t.deadline;
    if (d === null || d === undefined) return 'none';
    if (d <= today) return 'today';
    return 'future';
  };
  const within = (a: AssignedTask, b: AssignedTask): number =>
    pendingScore(b) - pendingScore(a) || (a.deadline ?? '').localeCompare(b.deadline ?? '');
  const byKey = new Map<string, AssignedTask[]>();
  for (const t of tasks) {
    const k = bucketOf(t);
    const arr = byKey.get(k);
    if (arr) arr.push(t);
    else byKey.set(k, [t]);
  }
  const defs = [
    { key: 'none', label: 'Без срока' },
    { key: 'today', label: 'На сегодня' },
    { key: 'future', label: 'Будущее' },
  ] as const;
  return defs.map((d) => {
    const items = (byKey.get(d.key) ?? []).slice();
    items.sort(within);
    return { key: d.key, label: d.label, isInbox: false, items };
  });
}

function groupByPriority(tasks: readonly AssignedTask[]): AssignedDisplayGroup[] {
  const bucketOf = (t: AssignedTask): string =>
    t.priority === null || t.priority === undefined ? 'none' : String(t.priority);
  const within = (a: AssignedTask, b: AssignedTask): number =>
    pendingScore(b) - pendingScore(a) || a.position - b.position;
  // Подписи зеркалят domain/task/priorityMeta.ts (1=Срочно … 4=Низкий).
  return buildFixed(
    tasks,
    [
      { key: '1', label: 'Срочно' },
      { key: '2', label: 'Высокий' },
      { key: '3', label: 'Средний' },
      { key: '4', label: 'Низкий' },
      { key: 'none', label: 'Без приоритета' },
    ],
    bucketOf,
    within,
  );
}
