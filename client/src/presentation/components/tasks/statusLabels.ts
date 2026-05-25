import type { TaskStatus } from '@/domain/task/Task';

// Visual-only label for kanban column header, status badge, in-card chip.
// The domain enum keeps `backlog/todo/...`; this is the user-facing rename.
export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'ЧЕРНОВИКИ',
  todo: 'ВОРКЕР',
  in_progress: 'В работе',
  awaiting_clarification: '🤔 На уточнении',
  done: 'Готово',
};

// Optional small subtitle rendered under the main label in column header.
// Currently only for `todo` (ВОРКЕР · Claude Opus). null/undefined = no subtitle.
export const STATUS_SUBTITLE: Partial<Record<TaskStatus, string>> = {
  todo: 'Claude Opus',
};
