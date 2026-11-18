import type { Task } from './Task';

// Фильтр «Только из групп»: задачи, поставленные в рабочей Telegram-группе (groupOrigin, db/190).
export function isFromGroup(task: Pick<Task, 'groupOrigin'>): boolean {
  return task.groupOrigin != null;
}

export function filterFromGroups<T extends Pick<Task, 'groupOrigin'>>(tasks: readonly T[], on: boolean): readonly T[] {
  return on ? tasks.filter(isFromGroup) : tasks;
}
