import type { Task, TaskStatus } from '@/domain/task/Task';

export type ComposerTarget = 'draft' | 'worker';

// Куда move'нуть задачу при текущем статусе + выбранном target'е. null = no move.
export function resolveMoveTarget(
  current: TaskStatus,
  target: ComposerTarget,
): TaskStatus | null {
  if (target === 'draft') {
    return current === 'backlog' ? null : 'backlog';
  }
  return current === 'todo' ? null : 'todo';
}

// Автоперенос по комментарию — только для СВОИХ задач (комментатор == исполнитель).
// Раньше move срабатывал на КАЖДЫЙ комментарий независимо от автора: руководитель открывал
// задачу сотрудника, писал комментарий — и задача уезжала из «В работе» просто потому что
// в localStorage была сохранена чья-то последняя цель отправки. На чужой задаче это сюрприз
// для владельца доски, поэтому там комментарий отправляется как есть, без переноса статуса.
export function shouldAutoMoveAfterComment(
  task: Pick<Task, 'assignee'>,
  currentUserId: string | null,
): boolean {
  return currentUserId !== null && task.assignee?.userId === currentUserId;
}
