import type { Task } from './Task';
import type { TaskDelegation } from './TaskDelegation';

// Задача с активной (pending|accepted) делегацией — строка блока делегирования на
// «Входящих»: вкладка «Для меня» (я — делегат) и «Другим» (я — делегатор), shape общий.
// canModify — можно ли отметить выполненной: для делегата — accepted + (inbox-делегат ИЛИ
// editor+ именованного проекта), для pending = false; для делегатора — его роль в проекте
// (свою задачу можно закрыть не дожидаясь делегата).
export type AssignedTask = Task & {
  readonly delegation: TaskDelegation;
  readonly projectId: string;
  readonly projectName: string;
  readonly isInbox: boolean;
  readonly canModify: boolean;
};

