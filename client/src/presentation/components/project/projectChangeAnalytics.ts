import type {
  ActivityEventItem,
  ActivityFieldChange,
} from '@/domain/activity/ActivityFeedItem';

export type ProjectChangeCategory =
  | 'all'
  | 'status'
  | 'deadline'
  | 'assignee'
  | 'description'
  | 'priority'
  | 'files'
  | 'tasks'
  | 'comments'
  | 'project'
  | 'members';

export type ProjectChangeSort = 'newest' | 'oldest';

export type ProjectChangeFilters = {
  readonly windowDays: number;
  readonly category: ProjectChangeCategory;
  readonly actorKey: string;
  readonly query: string;
  readonly sort: ProjectChangeSort;
};

export type ProjectChangeBreakdownItem = {
  readonly category: Exclude<ProjectChangeCategory, 'all'>;
  readonly count: number;
};

export type ProjectChangeActor = {
  readonly key: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly count: number;
};

export type ProjectChangeDay = {
  readonly date: Date;
  readonly count: number;
};

export type ProjectChangeAnalytics = {
  readonly items: ActivityEventItem[];
  readonly totalChanges: number;
  readonly taskCount: number;
  readonly actorCount: number;
  readonly todayCount: number;
  readonly fieldChangeCount: number;
  readonly breakdown: ProjectChangeBreakdownItem[];
  readonly actors: ProjectChangeActor[];
  readonly perDay: ProjectChangeDay[];
};

export const PROJECT_CHANGE_CATEGORY_LABEL: Record<ProjectChangeCategory, string> = {
  all: 'Все изменения',
  status: 'Статусы',
  deadline: 'Дедлайны',
  assignee: 'Ответственные',
  description: 'Описания',
  priority: 'Приоритеты',
  files: 'Файлы',
  tasks: 'Задачи',
  comments: 'Комментарии',
  project: 'Проект',
  members: 'Участники',
};

const FIELD_CATEGORY: Record<string, Exclude<ProjectChangeCategory, 'all'>> = {
  status: 'status',
  deadline: 'deadline',
  startDate: 'deadline',
  assigneeUserId: 'assignee',
  assignee: 'assignee',
  description: 'description',
  priority: 'priority',
  attachments: 'files',
  cover: 'files',
};

const FIELD_LABEL: Record<string, string> = {
  description: 'описание',
  status: 'статус',
  deadline: 'дедлайн',
  priority: 'приоритет',
  assigneeUserId: 'ответственный',
  assignee: 'ответственный',
  ralphMode: 'режим',
  name: 'название',
  cover: 'обложка',
  attachments: 'файлы',
  startDate: 'дата начала',
};

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(value: Date): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function cleanText(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/[*_~`=#>()]/g, ' ')
    .replaceAll('[', ' ')
    .replaceAll(']', ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function projectChangeActorKey(item: ActivityEventItem): string {
  return item.actorUserId ?? `name:${item.actorDisplayName ?? 'unknown'}`;
}

export function projectChangeCategories(
  item: ActivityEventItem,
): Exclude<ProjectChangeCategory, 'all'>[] {
  switch (item.kind) {
    case 'task_status_changed':
      return ['status'];
    case 'task_updated': {
      const categories = new Set<Exclude<ProjectChangeCategory, 'all'>>();
      for (const change of item.payload?.changes ?? []) {
        categories.add(FIELD_CATEGORY[change.field] ?? 'tasks');
      }
      return categories.size > 0 ? [...categories] : ['tasks'];
    }
    case 'task_created':
    case 'task_deleted':
      return ['tasks'];
    case 'task_commented':
      return ['comments'];
    case 'project_created':
    case 'project_updated':
    case 'project_archived':
    case 'project_deleted':
      return ['project'];
    case 'member_added':
    case 'member_removed':
    case 'member_role_changed':
      return ['members'];
  }
}

export function projectChangeTitle(item: ActivityEventItem): string {
  switch (item.kind) {
    case 'task_created':
      return 'Создана задача';
    case 'task_status_changed':
      return 'Изменён статус';
    case 'task_updated': {
      const changes = item.payload?.changes ?? [];
      if (changes.length === 0) return 'Изменена задача';
      if (changes.length === 1) {
        return `Изменено: ${FIELD_LABEL[changes[0]!.field] ?? changes[0]!.field}`;
      }
      return `Изменено полей: ${changes.length}`;
    }
    case 'task_deleted':
      return 'Удалена задача';
    case 'task_commented':
      return 'Добавлен комментарий';
    case 'project_created':
      return 'Создан проект';
    case 'project_updated':
      return 'Изменён проект';
    case 'project_archived':
      return 'Проект архивирован';
    case 'project_deleted':
      return 'Проект удалён';
    case 'member_added':
      return 'Добавлен участник';
    case 'member_removed':
      return 'Удалён участник';
    case 'member_role_changed':
      return 'Изменена роль';
  }
}

export function projectChangeSubject(item: ActivityEventItem): string {
  const payload = item.payload;
  if (payload?.taskExcerpt) return cleanText(payload.taskExcerpt).slice(0, 90);
  if (payload?.projectName) return cleanText(payload.projectName).slice(0, 90);
  if (item.targetDisplayName) return item.targetDisplayName;
  if (payload?.commentExcerpt) return cleanText(payload.commentExcerpt).slice(0, 90);
  return 'Без названия';
}

function changeSearchText(change: ActivityFieldChange): string {
  return [
    FIELD_LABEL[change.field] ?? change.field,
    change.old ?? '',
    change.new ?? '',
  ].join(' ');
}

function searchableText(item: ActivityEventItem): string {
  return [
    projectChangeTitle(item),
    projectChangeSubject(item),
    item.actorDisplayName ?? '',
    item.targetDisplayName ?? '',
    item.payload?.oldStatus ?? '',
    item.payload?.newStatus ?? '',
    item.payload?.commentExcerpt ?? '',
    ...(item.payload?.changes ?? []).map(changeSearchText),
  ]
    .join(' ')
    .toLocaleLowerCase('ru-RU');
}

function isWithinWindow(item: ActivityEventItem, windowDays: number, now: Date): boolean {
  if (windowDays >= 365) return true;
  return item.createdAt.getTime() >= now.getTime() - windowDays * DAY_MS;
}

function denseDays(
  items: readonly ActivityEventItem[],
  windowDays: number,
  now: Date,
): ProjectChangeDay[] {
  const chartDays = windowDays >= 365 ? 30 : Math.max(7, Math.min(windowDays, 90));
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = dayKey(item.createdAt);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const result: ProjectChangeDay[] = [];
  for (let offset = chartDays - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    result.push({ date, count: counts.get(dayKey(date)) ?? 0 });
  }
  return result;
}

export function buildProjectChangeAnalytics(
  source: readonly ActivityEventItem[],
  filters: ProjectChangeFilters,
  now = new Date(),
): ProjectChangeAnalytics {
  const query = filters.query.trim().toLocaleLowerCase('ru-RU');
  const periodItems = source.filter((item) => isWithinWindow(item, filters.windowDays, now));
  const items = periodItems
    .filter(
      (item) =>
        filters.category === 'all' ||
        projectChangeCategories(item).includes(filters.category),
    )
    .filter(
      (item) =>
        filters.actorKey === 'all' || projectChangeActorKey(item) === filters.actorKey,
    )
    .filter((item) => !query || searchableText(item).includes(query))
    .sort((left, right) =>
      filters.sort === 'newest'
        ? right.createdAt.getTime() - left.createdAt.getTime()
        : left.createdAt.getTime() - right.createdAt.getTime(),
    );

  const tasks = new Set<string>();
  const actorMap = new Map<string, ProjectChangeActor>();
  const categoryCounts = new Map<Exclude<ProjectChangeCategory, 'all'>, number>();
  let fieldChangeCount = 0;
  for (const item of items) {
    if (item.payload?.taskId) tasks.add(item.payload.taskId);
    const actorKey = projectChangeActorKey(item);
    const currentActor = actorMap.get(actorKey);
    actorMap.set(actorKey, {
      key: actorKey,
      name: item.actorDisplayName ?? 'Система',
      avatarUrl: item.actorAvatarUrl,
      count: (currentActor?.count ?? 0) + 1,
    });
    for (const category of projectChangeCategories(item)) {
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }
    fieldChangeCount += Math.max(1, item.payload?.changes?.length ?? 0);
  }

  const breakdown = [...categoryCounts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => right.count - left.count);
  const actors = [...actorMap.values()].sort((left, right) => right.count - left.count);

  return {
    items,
    totalChanges: items.length,
    taskCount: tasks.size,
    actorCount: actorMap.size,
    todayCount: items.filter((item) => dayKey(item.createdAt) === dayKey(now)).length,
    fieldChangeCount,
    breakdown,
    actors,
    perDay: denseDays(items, filters.windowDays, now),
  };
}
