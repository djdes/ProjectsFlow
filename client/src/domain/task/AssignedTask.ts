import type { Task } from './Task';

// Задача из assignee-проекций «Для меня» / «Другим». Текущий ответственный всегда
// находится в обязательном Task.assignee; отдельного delegation-shape больше нет.
// canModify приходит с сервера и учитывает task-scoped право ответственного/роль в проекте.
export type AssignedTask = Task & {
  readonly projectId: string;
  readonly projectName: string;
  readonly isInbox: boolean;
  readonly canModify: boolean;
  // Владелец личных входящих, где лежит задача (null у именованных проектов). Нужен для
  // вкладки «Для всех»: там видны личные доски коллег, и подпись «Личные · <имя>» честно
  // говорит, чьи это входящие. Своя личная задача всегда у себя — там просто «Личные».
  readonly inboxOwner?: { readonly userId: string; readonly displayName: string } | null;
};

