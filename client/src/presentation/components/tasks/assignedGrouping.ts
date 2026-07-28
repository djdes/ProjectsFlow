import type { AssignedGrouping } from '@/domain/user/UiPrefs';
import type { InboxBlockTask } from './inboxBlockTasks';

// Группа для рендера верхнего личного блока. В отличие от прежней доменной AssignedGroup
// (всегда по проекту) — это результат произвольной группировки (проект/дата/дедлайн/
// приоритет). `key` — стабильный React-key и id бакета; `isInbox` важен только для
// project-режима (выбор иконки заголовка), иначе false.
export type AssignedDisplayGroup = {
  readonly key: string;
  readonly label: string;
  readonly isInbox: boolean;
  readonly items: InboxBlockTask[];
};

// Направление ответственности: 'toMe' — отвечаю я; 'byMe' — отвечает другой участник.
// Влияет только на project-группировку inbox-задач (чьим именем подписывать «Личные»).
export type AssigneeDirection = 'toMe' | 'byMe';

// Чистая функция группировки — вся логика бакетов здесь (тестируется без React/DOM).
// `now` передаётся явно, чтобы границы дней («сегодня/вчера/неделя») были детерминированы.
export function groupAssignedTasks(
  tasks: readonly InboxBlockTask[],
  mode: AssignedGrouping,
  now: Date,
  direction: AssigneeDirection = 'toMe',
  // Канонический порядок проектов (их id в том же порядке, что в сайдбаре) — задаёт
  // порядок колонок в project-режиме. Пустой = порядок только по названию.
  projectOrder: readonly string[] = [],
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
      return groupByProject(tasks, direction, projectOrder);
  }
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// Локальная дата YYYY-MM-DD — для лексикографического (= хронологического) сравнения
// со строковыми task.deadline.
export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Конец текущей недели (воскресенье) как YYYY-MM-DD. Если сегодня уже вс — следующее вс,
// чтобы дата осталась в будущем (для перетаскивания в колонку «Будущее»).
export function endOfWeekYmd(now: Date): string {
  const sod = startOfDay(now);
  const dow = sod.getDay(); // 0=вс … 6=сб
  const daysToSunday = dow === 0 ? 7 : 7 - dow;
  return ymd(addDays(sod, daysToSunday));
}

// Последний день текущего месяца как YYYY-MM-DD.
export function endOfMonthYmd(now: Date): string {
  return ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0));
}

function groupByProject(
  tasks: readonly InboxBlockTask[],
  direction: AssigneeDirection,
  projectOrder: readonly string[],
): AssignedDisplayGroup[] {
  const map = new Map<string, AssignedDisplayGroup>();
  for (const t of tasks) {
    // Inbox в «Для меня» — единая личная группа без упоминания автора. Во
    // вкладке «Другим» задачи группируются только по текущему ответственному.
    const key = t.isInbox
      ? direction === 'byMe'
        ? `inbox:${t.assignee.userId}`
        : 'inbox'
      : t.projectId;
    let g = map.get(key);
    if (!g) {
      const label = t.isInbox
        ? direction === 'byMe'
          ? `Личные · ${t.assignee.displayName}`
          : 'Личные'
        : t.projectName;
      g = { key, label, isInbox: t.isInbox, items: [] };
      map.set(key, g);
    }
    g.items.push(t);
  }
  // Порядок колонок НЕ должен зависеть от того, какие задачи сейчас на доске. Раньше группы
  // шли в порядке первого появления задачи: стоило закрыть одну задачу — и колонка проекта
  // прыгала на несколько позиций вправо. Берём канонический порядок проектов (тот же, что в
  // сайдбаре); проекты вне списка (архивные, чужие) — по алфавиту следом; «Личные» — в конец.
  const rank = new Map(projectOrder.map((id, i) => [id, i]));
  const groups = [...map.values()];
  groups.sort((a, b) => {
    if (a.isInbox !== b.isInbox) return a.isInbox ? 1 : -1;
    if (!a.isInbox) {
      const ra = rank.get(a.key) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.key) ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
    }
    return a.label.localeCompare(b.label, 'ru');
  });
  return groups;
}

// Универсальный сборщик для режимов с фиксированным набором бакетов: раскладывает задачи
// по ключам, сортирует внутри и отдаёт непустые бакеты в порядке `defs`.
function buildFixed(
  tasks: readonly InboxBlockTask[],
  defs: readonly { key: string; label: string }[],
  bucketOf: (t: InboxBlockTask) => string,
  within: (a: InboxBlockTask, b: InboxBlockTask) => number,
): AssignedDisplayGroup[] {
  const byKey = new Map<string, InboxBlockTask[]>();
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

function groupByCreated(tasks: readonly InboxBlockTask[], now: Date): AssignedDisplayGroup[] {
  const sod = startOfDay(now);
  const tToday = sod.getTime();
  const tYesterday = addDays(sod, -1).getTime();
  const tWeek = addDays(sod, -7).getTime();
  const bucketOf = (t: InboxBlockTask): string => {
    const x = t.createdAt.getTime();
    if (x >= tToday) return 'today';
    if (x >= tYesterday) return 'yesterday';
    if (x >= tWeek) return 'week';
    return 'earlier';
  };
  const within = (a: InboxBlockTask, b: InboxBlockTask): number =>
    b.createdAt.getTime() - a.createdAt.getTime();
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

function groupByDeadline(tasks: readonly InboxBlockTask[], now: Date): AssignedDisplayGroup[] {
  const sod = startOfDay(now);
  const today = ymd(sod);
  const tomorrow = ymd(addDays(sod, 1));
  const weekEnd = ymd(addDays(sod, 7));
  const bucketOf = (t: InboxBlockTask): string => {
    const d = t.deadline;
    if (d === null) return 'none';
    if (d < today) return 'overdue';
    if (d === today) return 'today';
    if (d === tomorrow) return 'tomorrow';
    if (d <= weekEnd) return 'week';
    return 'later';
  };
  const within = (a: InboxBlockTask, b: InboxBlockTask): number =>
    (a.deadline ?? '').localeCompare(b.deadline ?? '');
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

// Личный канбан по ВРЕМЕНИ: РОВНО 3 колонки, всегда все три (даже пустые — как
// колонки доски проекта). Бакет по дедлайну: нет дедлайна → «Без срока»; дедлайн сегодня или
// раньше (включая просроченные) → «На сегодня»; дедлайн позже сегодня → «Будущее». `key` бакета
// ('none'/'today'/'future') используется в UI для выбора иконки колонки.
export function groupAssignedByTime(
  tasks: readonly InboxBlockTask[],
  now: Date,
): AssignedDisplayGroup[] {
  const today = ymd(startOfDay(now));
  const bucketOf = (t: InboxBlockTask): 'none' | 'today' | 'future' => {
    const d = t.deadline;
    if (d === null || d === undefined) return 'none';
    if (d <= today) return 'today';
    return 'future';
  };
  const within = (a: InboxBlockTask, b: InboxBlockTask): number =>
    (a.deadline ?? '').localeCompare(b.deadline ?? '');
  const byKey = new Map<string, InboxBlockTask[]>();
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

function groupByPriority(tasks: readonly InboxBlockTask[]): AssignedDisplayGroup[] {
  const bucketOf = (t: InboxBlockTask): string =>
    t.priority === null || t.priority === undefined ? 'none' : String(t.priority);
  const within = (a: InboxBlockTask, b: InboxBlockTask): number => a.position - b.position;
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
