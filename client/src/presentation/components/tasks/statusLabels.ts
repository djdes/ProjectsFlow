import type { TaskStatus } from '@/domain/task/Task';

// Visual-only label for kanban column header, status badge, in-card chip.
// The domain enum keeps `backlog/todo/...`; this is the user-facing rename.
export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Черновики',
  manual: 'Вручную',
  todo: 'Воркер',
  in_progress: 'В работе',
  awaiting_clarification: '🤔 На уточнении',
  pending_approval: 'На утверждении',
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
// workerEnabled=false (db/152): колонки «Воркер» нет, поэтому шаг из «Вручную» ведёт сразу
// в «Готово» — иначе стрелка перекладывала бы задачу в колонку, которой не видно.
export function quickPromoteNext(status: TaskStatus, workerEnabled = true): TaskStatus | null {
  const visible = status === 'in_progress' || status === 'awaiting_clarification' ? 'todo' : status;
  const next = ADVANCE_NEXT[visible] ?? null;
  if (next === 'todo' && !workerEnabled) return 'done';
  return next;
}

// Optional small subtitle rendered next to the main label in column header.
// Только для `todo` (Воркер). Коротко «Opus»: полное «Claude Opus» отъедало ширину
// у названия и резалось многоточием («Claude Op…»). null/undefined = без подписи.
export const STATUS_SUBTITLE: Partial<Record<TaskStatus, string>> = {
  todo: 'Opus',
};
