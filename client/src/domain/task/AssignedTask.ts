import type { Task } from './Task';

// Задача из assignee-проекций «Для меня» / «Другим». Текущий ответственный всегда
// находится в обязательном Task.assignee; отдельного delegation-shape больше нет.
// canModify приходит с сервера и учитывает task-scoped право ответственного/роль в проекте.
export type AssignedTask = Task & {
  readonly projectId: string;
  readonly projectName: string;
  readonly isInbox: boolean;
  readonly canModify: boolean;
};

