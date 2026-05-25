// 'awaiting_clarification' — активная работа на паузе до действия человека
// (ответ на ralph-question, разбор после maxAttempts retry, переформулировка задачи,
// auto-timeout F11). В пайплайне сидит между in_progress и done, поэтому в массиве
// тоже между ними — порядок определяет колонки канбана и фильтры.
export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'awaiting_clarification' | 'done';

export const TASK_STATUSES: readonly TaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'awaiting_clarification',
  'done',
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
  readonly createdAt: Date;
  readonly updatedAt: Date;
};
