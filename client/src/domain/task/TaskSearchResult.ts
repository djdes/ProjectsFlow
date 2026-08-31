import type { TaskStatus } from './Task';

// Где нашлось совпадение: в описании задачи или в теле одного из её комментариев.
export type TaskSearchMatchKind = 'description' | 'comment';

// Результат глобального поиска по задачам. Плоский DTO для палитры поиска:
// строка-результат + переход на доску проекта.
export type TaskSearchResult = {
  readonly taskId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly status: TaskStatus;
  readonly excerpt: string;
  // ISO-дата создания задачи (для сортировки результатов сайдбар-поиска по свежести).
  readonly createdAt: string;
  // Отсутствует у ответов старого сервера — читатели трактуют как 'description'.
  readonly match?: TaskSearchMatchKind;
  // Только при match='comment': deep-link на комментарий (?task=X#comment-Y) и отрывок
  // его тела вокруг найденного вхождения — его и подсвечиваем в результатах.
  readonly commentId?: string;
  readonly commentExcerpt?: string;
};
