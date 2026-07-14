import type { TaskStatus, TaskPriority } from '../task/Task.js';

// Публичная выдача доски (Publish to web, db/096). ЕДИНСТВЕННАЯ граница приватности:
// только перечисленные здесь поля покидают периметр. Внутренние поля задачи (createdBy,
// assignee, ralph*, statusBeforeDone, position) и всё project-internal (финансы,
// участники, креды, LIVE, ownerId) сюда НЕ попадают.

export type PublicTask = {
  readonly id: string;
  // Тело задачи. Заголовок карточки клиент выводит из первой строки description
  // (splitTitleBody) — так же, как в приватном канбане.
  readonly description: string | null;
  readonly icon: string | null;
  readonly cover: string | null;
  readonly coverPosition: number;
  readonly status: TaskStatus;
  readonly priority: TaskPriority | null;
  readonly deadline: string | null;
};

export type PublicColumn = {
  readonly status: TaskStatus;
  readonly tasks: PublicTask[];
};

export type PublicBoard = {
  readonly slug: string;
  readonly name: string;
  readonly icon: string | null;
  readonly description: string | null;
  // Обложка: `gradient:<id>` или внешний URL — как есть; загруженный файл проекта
  // переписан на анонимный /api/public/boards/:slug/cover (см. publicCoverUrl).
  readonly coverUrl: string | null;
  readonly coverPosition: number;
  // Тоггл индексации: клиент ставит <meta robots noindex> пока false.
  readonly indexing: boolean;
  // Все статусы в порядке TASK_STATUSES; пустые колонки клиент может не рисовать.
  readonly columns: PublicColumn[];
};

// Read-only деталь задачи для окна на публичной доске. Расширяет карточную выдачу телом
// (с переписанными URL картинок) и комментариями (только человеческие, read-only). НЕ содержит
// ответственного/ralph/коммитов/LIVE/списка участников. См. spec public-task-detail-and-gate.
export type PublicComment = {
  readonly id: string;
  readonly authorDisplayName: string;
  readonly authorAvatarUrl: string | null;
  readonly body: string;
  readonly createdAt: string; // ISO
};

export type PublicTaskDetail = {
  readonly id: string;
  // Тело задачи с абзацами/фото; ссылки на вложения переписаны на публичный роут.
  readonly description: string | null;
  readonly icon: string | null;
  readonly cover: string | null;
  readonly coverPosition: number;
  readonly status: TaskStatus;
  readonly priority: TaskPriority | null;
  readonly deadline: string | null;
  readonly comments: PublicComment[];
};
