import type { TaskDelegation } from './TaskDelegation.js';

// 'awaiting_clarification' — активная работа на паузе до действия человека
// (ответ на ralph-question, разбор после maxAttempts retry, переформулировка задачи,
// auto-timeout F11). В пайплайне сидит между in_progress и done, поэтому в массиве
// тоже между ними — порядок определяет колонки канбана и фильтры.
//
// 'manual' — отдельная ветка ВНЕ pipeline'а: задачи которые делает человек руками.
// Не имеет авто-переходов; в array идёт в конец чтобы numeric storage order существующих
// строк MariaDB ENUM не менялся (см. db/038).
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

// Режим работы Ralph по задаче. См. spec C:/www/ralph/prompts/task-ralph-mode.md.
//   'normal'  — дефолт: worker может задать ralph-question; pre-worker grillme — по триггерам.
//   'silent'  — worker не задаёт вопросов; при неясности сразу blocked. Grillme skip.
//   'grillme' — принудительно запускается grillme (до 10 вопросов), затем worker как normal.
export type RalphMode = 'normal' | 'silent' | 'grillme';

export const RALPH_MODES: readonly RalphMode[] = ['normal', 'silent', 'grillme'];

// Приоритет в стиле Todoist: 1=urgent (red), 2=high (orange), 3=medium (blue),
// 4=low (slate). null = без приоритета (без подсветки). См. db/041.
export type TaskPriority = 1 | 2 | 3 | 4;

export const TASK_PRIORITIES: readonly TaskPriority[] = [1, 2, 3, 4];

export type Task = {
  readonly id: string;
  readonly projectId: string;
  readonly description: string | null;
  readonly status: TaskStatus;
  readonly position: number;
  readonly ralphMode: RalphMode;
  // Pull-based cancel: момент когда юзер запросил отмену Ralph-работы (NULL = нет
  // запроса). См. db/037, spec C:/www/ralph/prompts/task-ralph-cancel.md.
  readonly ralphCancelRequestedAt: Date | null;
  // Кто запросил (FK на users). NULL когда запроса нет.
  readonly ralphCancelRequestedBy: string | null;
  // Display name запросившего — заполняется через LEFT JOIN users в repository.
  // Null если запроса нет ИЛИ юзер удалён.
  readonly ralphCancelRequestedByDisplayName: string | null;
  // Срок выполнения. Date-only ISO-string 'YYYY-MM-DD' для избегания TZ-багов
  // (UI рендерит через Intl.DateTimeFormat, parsing через new Date(value)).
  // null = без deadline. См. db/041.
  readonly deadline: string | null;
  // Приоритет 1..4 (1=urgent, 4=low). null = без приоритета. См. db/041.
  readonly priority: TaskPriority | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  // Активная (pending|accepted) делегация — null если задача не делегирована.
  // Заполняется list/get-endpoint'ом left-join'ом на task_delegations (см. db/039).
  // Optional: не все repository-call'ы джойнят (e.g. agent-internal getById),
  // поэтому undefined трактуется как «не загружено», null — «гарантированно нет».
  readonly delegation?: TaskDelegation | null;
};
