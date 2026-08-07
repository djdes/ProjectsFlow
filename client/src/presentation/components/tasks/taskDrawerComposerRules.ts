import type { Task, TaskStatus } from '@/domain/task/Task';

export type ComposerTarget = 'draft' | 'worker';

// Ветки ВНЕ pipeline'а воркера: человек положил задачу сюда руками и авто-переходов
// у них нет по определению (см. TaskStatus). Комментарий или правка не должны выдёргивать
// такую задачу в «Черновики»/«Воркеру» — она остаётся там, куда её положили.
const NO_AUTO_TRANSITION: readonly TaskStatus[] = [
  'manual',
  'custom_1',
  'custom_2',
  'custom_3',
  'custom_4',
  'custom_5',
];

// Показывать ли выбор цели отправки («В черновики» / «Передать воркеру»). На статусах вне
// pipeline'а выбор бессмысленен: move всё равно не произойдёт, а подпись у кнопки обещала бы
// перенос, которого не будет.
export function canChooseSendTarget(current: TaskStatus): boolean {
  return !NO_AUTO_TRANSITION.includes(current);
}

// Куда move'нуть задачу при текущем статусе + выбранном target'е. null = no move.
export function resolveMoveTarget(
  current: TaskStatus,
  target: ComposerTarget,
): TaskStatus | null {
  if (NO_AUTO_TRANSITION.includes(current)) return null;
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
