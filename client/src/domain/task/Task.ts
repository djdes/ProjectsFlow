import type { TaskDelegation } from './TaskDelegation';

// 'awaiting_clarification' — активная задача на паузе до действия человека (ответ на
// ralph-question, разбор после maxAttempts retry, переформулировка). Между in_progress
// и done — порядок в массиве определяет колонки канбана.
//
// 'manual' — отдельная ветка ВНЕ pipeline'а: колонка для задач, которые делает человек
// руками. Не имеет авто-переходов. В array идёт в конец чтобы зеркалить ENUM (db/038).
export type TaskStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'awaiting_clarification'
  | 'done'
  | 'manual';

export const TASK_STATUSES: readonly TaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'awaiting_clarification',
  'done',
  'manual',
];

// Режим работы Ralph по задаче. Mirrors server/src/domain/task/Task.ts.
// См. spec C:/www/ralph/prompts/task-ralph-mode.md.
export type RalphMode = 'normal' | 'silent' | 'grillme';

export const RALPH_MODES: readonly RalphMode[] = ['normal', 'silent', 'grillme'];

// Приоритет в стиле Todoist: 1=urgent (red), 2=high (orange), 3=medium (blue),
// 4=low (slate). null = без приоритета. См. db/041, domain/task/priorityMeta.ts
// для label/color metadata.
export type TaskPriority = 1 | 2 | 3 | 4;

export const TASK_PRIORITIES: readonly TaskPriority[] = [1, 2, 3, 4];

// Метаданные для UI dropdown / badge — label, описание (tooltip), иконка.
// Иконки — emoji для быстрой визуальной идентификации в плотной канбан-сетке.
export const RALPH_MODE_META: Record<RalphMode, { label: string; description: string; icon: string }> = {
  normal: {
    label: 'Обычный',
    description: 'Стандартный режим, если есть вопросы — задаются',
    icon: '🤖',
  },
  silent: {
    label: 'Тихий',
    description: 'Ничего не спрашивает, просто делает',
    icon: '🔇',
  },
  grillme: {
    label: 'Много вопросов',
    description: 'Скилл GrillMe: много вопросов, потом работа',
    icon: '🎓',
  },
};

export type Task = {
  readonly id: string;
  readonly projectId: string;
  readonly description: string | null;
  // Иконка задачи: эмодзи / lucide:Name[:color] / data-URL картинки. null = без иконки. См. db/093.
  readonly icon: string | null;
  // Обложка задачи (Notion-style): CSS-градиент/пресет или data-URL картинки. null = без обложки. См. db/094.
  readonly cover: string | null;
  // Вертикальное положение фокуса обложки (0..100). Дефолт 50 = центр. См. db/094.
  readonly coverPosition: number;
  readonly status: TaskStatus;
  // Статус до перехода в 'done' — для восстановления прежней колонки при снятии галочки.
  // null = нет снапшота. Заполняется backend'ом (db/055). Optional на проводе.
  readonly statusBeforeDone: TaskStatus | null;
  readonly position: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  // Заполняются list-эндпоинтом. Для одиночных task-fetch'ей могут отсутствовать.
  readonly commitCount?: number;
  readonly attachmentCount?: number;
  readonly commentCount?: number;
  // Режим работы Ralph (default 'normal' если backend без 035).
  readonly ralphMode: RalphMode;
  // Pull-based отмена Ralph-работы (db/037). null = нет запроса. См. spec
  // C:/www/ralph/prompts/task-ralph-cancel.md.
  readonly ralphCancelRequestedAt: Date | null;
  readonly ralphCancelRequestedBy: string | null;
  readonly ralphCancelRequestedByDisplayName: string | null;
  // Срок выполнения. ISO-string 'YYYY-MM-DD' (без времени). null = не задан. См. db/041.
  readonly deadline: string | null;
  // Дата начала работ (db/106): диапазон startDate → deadline (Notion date range).
  // null = событие одного дня (только deadline).
  readonly startDate: string | null;
  // Приоритет 1..4 (1=urgent, 4=low). null = без приоритета. См. db/041.
  readonly priority: TaskPriority | null;
  // Активная (pending|accepted) делегация — null если задача не делегирована.
  // Заполняется list-endpoint'ом left-join'ом. Optional: undefined = «не загружено».
  readonly delegation?: TaskDelegation | null;
};

// Короткий ID задачи (первые 8 hex-символов UUID без дефисов) — для вставки в commit
// message в формате `[xxxxxxxx]`. Server'ный SyncTaskCommits парсит этот pattern.
export function taskShortId(taskId: string): string {
  return taskId.replace(/-/g, '').slice(0, 8).toLowerCase();
}
