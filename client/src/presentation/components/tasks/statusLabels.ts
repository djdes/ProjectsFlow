import type { TaskStatus } from '@/domain/task/Task';

// Visual-only label for kanban column header, status badge, in-card chip.
// The domain enum keeps `backlog/todo/...`; this is the user-facing rename.
export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Черновики',
  manual: 'Вручную',
  todo: 'Воркер',
  in_progress: 'В работе',
  awaiting_clarification: '🤔 На уточнении',
  done: 'Готово',
};

// Прогрессия «шаг вперёд» по видимым колонкам: Черновики→Вручную→Воркер→Готово.
// Один источник для кнопки-стрелки на карточке (KanbanCard) и сплит-пилюли в окне задачи.
export const ADVANCE_NEXT: Partial<Record<TaskStatus, TaskStatus>> = {
  backlog: 'manual',
  manual: 'todo',
  todo: 'done',
};

// Следующий статус для быстрого «передать дальше». in_progress/awaiting_clarification
// визуально живут в колонке «Воркер» (todo) → у них следующий = done. null = дальше некуда.
export function quickPromoteNext(status: TaskStatus): TaskStatus | null {
  const visible = status === 'in_progress' || status === 'awaiting_clarification' ? 'todo' : status;
  return ADVANCE_NEXT[visible] ?? null;
}

// Optional small subtitle rendered under the main label in column header.
// Currently only for `todo` (ВОРКЕР · Claude Opus). null/undefined = no subtitle.
export const STATUS_SUBTITLE: Partial<Record<TaskStatus, string>> = {
  todo: 'Claude Opus',
};
