import type {
  InlineKeyboardButton,
  InlineKeyboardMarkup,
} from '../telegram/TelegramClient.js';

export type TelegramDigestSort =
  | 'default'
  | 'deadline'
  | 'priority'
  | 'project'
  | 'assignee';

export type TelegramDigestKeyboardTask = {
  readonly taskId: string;
  readonly name: string;
  readonly openLink: string;
  readonly projectName: string;
  readonly assigneeName: string;
  readonly deadline: string | null;
  readonly priority: number | null;
  readonly position: number;
  readonly completed: boolean;
};

const SORTS: ReadonlyArray<{
  readonly value: TelegramDigestSort;
  readonly label: string;
}> = [
  { value: 'default', label: '↕ Исходный' },
  { value: 'deadline', label: '📅 Дедлайн' },
  { value: 'priority', label: '🚩 Приоритет' },
  { value: 'project', label: '📁 Проект' },
  { value: 'assignee', label: '👤 Ответственный' },
];
const MSK_DATE = new Intl.DateTimeFormat('en', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function parseTelegramDigestSort(value: string): TelegramDigestSort {
  return SORTS.some((sort) => sort.value === value)
    ? (value as TelegramDigestSort)
    : 'default';
}

export function collapsedTelegramDigestKeyboard(
  taskCount: number,
  sort: TelegramDigestSort = 'default',
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: `Показать задачи (${taskCount})`,
          callback_data: `dgx:${sort}`,
          style: 'primary',
        },
      ],
    ],
  };
}

export function expandedTelegramDigestKeyboard(
  input: readonly TelegramDigestKeyboardTask[],
  sort: TelegramDigestSort,
): InlineKeyboardMarkup {
  const tasks = sortTelegramDigestTasks(input, sort);
  const sortButtons = SORTS.map<InlineKeyboardButton>((item) => ({
    text: item.label,
    callback_data: `dgs:${item.value}`,
    ...(item.value === sort ? { style: 'primary' as const } : {}),
  }));
  const rows: InlineKeyboardButton[][] = [
    sortButtons.slice(0, 3),
    sortButtons.slice(3),
  ];

  for (const task of tasks.slice(0, 45)) {
    const deadline = compactDeadline(task.deadline);
    const meta = task.completed
      ? ' · готово'
      : deadline
        ? ` · ${deadline}`
        : '';
    rows.push([
      {
        text: task.completed ? '●' : '○',
        callback_data: `dgc:${sort}:${task.taskId}`,
        ...(task.completed ? { style: 'success' as const } : {}),
      },
      {
        text: `${task.completed ? '✓ ' : ''}${truncateButtonText(task.name, 38)}${meta}`,
        url: task.openLink,
      },
    ]);
  }
  if (tasks.length > 45) {
    rows.push([
      {
        text: `Ещё ${tasks.length - 45} задач`,
        callback_data: `dgm:${sort}`,
      },
    ]);
  }
  rows.push([
    {
      text: 'Скрыть задачи',
      callback_data: `dgh:${sort}`,
    },
  ]);
  return { inline_keyboard: rows };
}

export function sortTelegramDigestTasks(
  input: readonly TelegramDigestKeyboardTask[],
  sort: TelegramDigestSort,
): TelegramDigestKeyboardTask[] {
  const tasks = [...input];
  const completedLast = (
    left: TelegramDigestKeyboardTask,
    right: TelegramDigestKeyboardTask,
  ): number => Number(left.completed) - Number(right.completed);
  tasks.sort((left, right) => {
    const completed = completedLast(left, right);
    if (completed !== 0) return completed;
    if (sort === 'deadline') {
      const leftDeadline = left.deadline ?? '9999-12-31';
      const rightDeadline = right.deadline ?? '9999-12-31';
      return (
        leftDeadline.localeCompare(rightDeadline) ||
        left.projectName.localeCompare(right.projectName, 'ru') ||
        left.position - right.position
      );
    }
    if (sort === 'priority') {
      return (
        (left.priority ?? 99) - (right.priority ?? 99) ||
        left.projectName.localeCompare(right.projectName, 'ru') ||
        left.position - right.position
      );
    }
    if (sort === 'project') {
      return (
        left.projectName.localeCompare(right.projectName, 'ru') ||
        left.position - right.position
      );
    }
    if (sort === 'assignee') {
      return (
        left.assigneeName.localeCompare(right.assigneeName, 'ru') ||
        left.projectName.localeCompare(right.projectName, 'ru') ||
        left.position - right.position
      );
    }
    return (
      left.projectName.localeCompare(right.projectName, 'ru') ||
      left.position - right.position
    );
  });
  return tasks;
}

function compactDeadline(deadline: string | null): string {
  if (!deadline) return '';
  const target = Date.parse(`${deadline}T00:00:00Z`);
  if (!Number.isFinite(target)) return deadline;
  const parts = Object.fromEntries(
    MSK_DATE
      .formatToParts(new Date())
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  const today = Date.UTC(
    parts['year'] ?? 1970,
    (parts['month'] ?? 1) - 1,
    parts['day'] ?? 1,
  );
  const days = Math.round((target - today) / 86_400_000);
  if (days < 0) return `проср. ${Math.abs(days)}д`;
  if (days === 0) return 'сегодня';
  return `${days}д`;
}

function truncateButtonText(value: string, max: number): string {
  const compact = value.replace(/\s+/g, ' ').trim() || 'Без названия';
  return compact.length <= max
    ? compact
    : `${compact.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}
