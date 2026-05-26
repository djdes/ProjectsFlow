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

export type Task = {
  readonly id: string;
  readonly projectId: string;
  readonly description: string | null;
  readonly status: TaskStatus;
  readonly position: number;
  readonly delegatedToAgent: boolean;
  readonly ralphMode: RalphMode;
  // Pull-based cancel: момент когда юзер запросил отмену Ralph-работы (NULL = нет
  // запроса). См. db/037, spec C:/www/ralph/prompts/task-ralph-cancel.md.
  readonly ralphCancelRequestedAt: Date | null;
  // Кто запросил (FK на users). NULL когда запроса нет.
  readonly ralphCancelRequestedBy: string | null;
  // Display name запросившего — заполняется через LEFT JOIN users в repository.
  // Null если запроса нет ИЛИ юзер удалён.
  readonly ralphCancelRequestedByDisplayName: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
