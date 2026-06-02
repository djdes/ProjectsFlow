import type { Task } from './Task';
import type { TaskDelegation } from './TaskDelegation';

// Задача, поручённая мне (для блока «Поручено мне»). Делегация гарантированно есть
// (активная pending|accepted). canModify — можно ли отметить выполненной (accepted +
// inbox-делегат ИЛИ editor+ участник именованного проекта); для pending = false.
export type AssignedTask = Task & {
  readonly delegation: TaskDelegation;
  readonly projectId: string;
  readonly projectName: string;
  readonly isInbox: boolean;
  readonly canModify: boolean;
};

// Группа блока «Поручено мне» — задачи одного проекта. Для inbox-проекта label = имя
// делегатора («Личные · {делегатор}»), для именованного — название проекта.
export type AssignedGroup = {
  readonly projectId: string;
  readonly label: string;
  readonly isInbox: boolean;
  readonly items: AssignedTask[];
};
