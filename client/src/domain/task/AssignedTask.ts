import type { Task } from './Task';
import type { TaskDelegation } from './TaskDelegation';

// Задача с делегацией (создаётся сразу accepted) — строка блока делегирования на
// «Входящих»: вкладка «Для меня» (я — делегат) и «Другим» (я — делегатор), shape общий.
// canModify приходит с сервера: можно ли отметить выполненной/перетащить — для делегата
// (inbox-делегат ИЛИ editor+ именованного проекта), для делегатора — его роль в проекте
// (свою задачу можно закрыть не дожидаясь делегата). status в TaskDelegation хранит
// pending/declined только как исторические значения БД — UI их не различает.
export type AssignedTask = Task & {
  readonly delegation: TaskDelegation;
  readonly projectId: string;
  readonly projectName: string;
  readonly isInbox: boolean;
  readonly canModify: boolean;
};

