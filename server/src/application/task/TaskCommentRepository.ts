import type {
  CommentNotifyMode,
  TaskComment,
  TaskCommentActorKind,
} from '../../domain/task/TaskComment.js';

export type CreateTaskCommentInput = {
  readonly id: string;
  readonly taskId: string;
  readonly ownerUserId: string;
  readonly body: string;
  // Тип актора. 'user' — дефолт для обратной совместимости; роуты явно указывают.
  readonly actorKind?: TaskCommentActorKind;
  // Конкретный agent (для UI title). NULL если actorKind != 'agent'.
  readonly agentName?: string | null;
  // Режим адресации уведомления. DEFAULT 'all'. См. db/047.
  readonly notifyMode?: CommentNotifyMode;
};

export type UpdateTaskCommentInput = {
  readonly id: string;
  readonly body: string;
};

// Серверные фильтры для agent-poll'инга (Ralph F11). Опциональные.
export type ListTaskCommentsFilters = {
  // ISO-граница: createdAt >= since. Срезает уже обработанные комменты.
  readonly since?: Date;
  // Лимит количества; caller отвечает за разумные значения (1..500).
  readonly limit?: number;
  // Подстрочный фильтр по body. Передаётся как ИДЕНТИФИКАТОР маркера ('ralph-question'
  // и т.п.); SQL ищет '<!-- {markerSubstring}'. Caller передаёт уже валидированную
  // строку — мы её LIKE-эскейпим внутри.
  readonly markerSubstring?: string;
};

export interface TaskCommentRepository {
  create(input: CreateTaskCommentInput): Promise<TaskComment>;
  getById(commentId: string): Promise<TaskComment | null>;
  // Старые сверху, новые снизу — как чат.
  listByTask(taskId: string): Promise<TaskComment[]>;
  // Тот же порядок (createdAt ASC), но с серверными фильтрами и лимитом — для agent-API.
  listByTaskFiltered(
    taskId: string,
    filters: ListTaskCommentsFilters,
  ): Promise<TaskComment[]>;
  update(input: UpdateTaskCommentInput): Promise<TaskComment | null>;
  delete(commentId: string): Promise<boolean>;
  // Чистка при удалении задачи — чтоб не оставались висячие comment-строки.
  deleteByTask(taskId: string): Promise<number>;
  // Кол-во комментариев по каждой задаче — для бейджа в списке задач.
  countsByTasks(taskIds: readonly string[]): Promise<ReadonlyMap<string, number>>;
}
