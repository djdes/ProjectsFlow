import type { RalphMode, Task, TaskPriority, TaskStatus } from '../../domain/task/Task.js';

export type CreateTaskInput = {
  readonly id: string;
  readonly projectId: string;
  // Кто создал («кто отдал воркеру») — инициатор для метеринга/гейта расхода (db/088).
  readonly createdBy: string | null;
  readonly description: string;
  // Иконка задачи: эмодзи / lucide:Name[:color] / data-URL. null/undefined = без иконки. См. db/093.
  readonly icon?: string | null;
  // Обложка задачи: CSS-градиент/пресет или data-URL. null/undefined = без обложки. См. db/094.
  readonly cover?: string | null;
  // Вертикальное положение фокуса обложки (0..100). undefined = дефолт 50. См. db/094.
  readonly coverPosition?: number;
  readonly status: TaskStatus;
  readonly position: number;
  // Режим работы Ralph (default 'normal'). См. domain RalphMode.
  readonly ralphMode?: RalphMode;
  // Срок выполнения (ISO 'YYYY-MM-DD'). null = без deadline.
  readonly deadline?: string | null;
  // Дата начала (диапазон startDate → deadline). null = событие одного дня.
  readonly startDate?: string | null;
  // Приоритет 1..4 (1=urgent, 4=low). null = без приоритета.
  readonly priority?: TaskPriority | null;
};

export type UpdateTaskPatch = {
  readonly description?: string | null;
  // null = очистить иконку. undefined = не менять. См. db/093.
  readonly icon?: string | null;
  // null = очистить обложку. undefined = не менять. См. db/094.
  readonly cover?: string | null;
  // Вертикальное положение фокуса обложки (0..100). undefined = не менять. См. db/094.
  readonly coverPosition?: number;
  readonly status?: TaskStatus;
  // Снимок статуса до 'done'. null = очистить. undefined = не менять. См. db/055, MoveTask.
  readonly statusBeforeDone?: TaskStatus | null;
  readonly position?: number;
  readonly ralphMode?: RalphMode;
  // null = очистить deadline. undefined = не менять.
  readonly deadline?: string | null;
  // null = очистить дату начала. undefined = не менять.
  readonly startDate?: string | null;
  // null = убрать приоритет. undefined = не менять.
  readonly priority?: TaskPriority | null;
};

export interface TaskRepository {
  listByProject(projectId: string): Promise<Task[]>;
  // Батч-выборка задач по id (для блока «Поручено мне» — задачи из разных проектов).
  // Порядок результата не гарантируется; вызывающий строит Map по id.
  listByIds(taskIds: readonly string[]): Promise<Task[]>;
  /**
   * Inbox-задачи (из ЧУЖИХ inbox-проектов), где caller — accepted-делегат.
   * Используется ListTasks для inbox-view'а делегата: он должен видеть в своём
   * /inbox список задачи, которые ему делегированы, хотя физически они живут
   * в inbox-проекте создателя.
   */
  listAcceptedDelegatedTo(userId: string): Promise<Task[]>;
  getById(taskId: string): Promise<Task | null>;
  create(input: CreateTaskInput): Promise<Task>;
  update(taskId: string, patch: UpdateTaskPatch): Promise<Task | null>;
  delete(taskId: string): Promise<boolean>;
  /**
   * Удалить задачу вместе со ВСЕМИ её child-строками (комментарии, аттачи, коммиты,
   * версии, делегации, live-сессии/события, telegram-маппинги, email-токены) в одной
   * транзакции. Без этого удаление задачи оставляло сироты (FK на схеме нет). Возвращает
   * true, если задача существовала.
   */
  deleteWithChildren(taskId: string): Promise<boolean>;
  // Возвращает min/max позицию в колонке — для расчёта новой position при insert "сверху" / "снизу".
  getPositionBounds(projectId: string, status: TaskStatus): Promise<{ min: number; max: number } | null>;
  /**
   * Перенумеровать колонку (projectId, status) целыми с равным шагом по текущему
   * порядку position. Нужно когда float-midpoint между соседями схлопывается (после
   * ~десятков вставок в одно место) и новую position уже не вставить без коллизии.
   * Атомарно (одна TX). Возвращает актуальную position указанной задачи после
   * перенумерации (или null, если её нет в колонке).
   */
  rebalanceColumn(projectId: string, status: TaskStatus, taskId: string): Promise<number | null>;
  /**
   * Установить ralph_cancel_requested_at = now() и ralph_cancel_requested_by = userId.
   * Идемпотентно: если уже установлено — оставляем существующие значения. Используется
   * RequestRalphCancel для signal'а Ralph диспетчеру.
   */
  requestRalphCancel(taskId: string, userId: string): Promise<Task | null>;
  /**
   * Сброс ralph_cancel_requested_at + by (NULL). Используется:
   *  - RevokeRalphCancel когда юзер передумал отменять
   *  - AckRalphCancel когда Ralph обработал отмену
   */
  clearRalphCancel(taskId: string): Promise<Task | null>;
  /**
   * Перенос задачи в другой проект (только для inbox → реальный). Меняет
   * tasks.project_id. Используется MoveTaskToProject use-case'ом.
   * Position не пересчитываем — задача попадает в проект с её текущим position
   * и status (как правило 'todo'/'done'); UI отсортирует.
   */
  moveToProject(taskId: string, targetProjectId: string): Promise<Task | null>;
}
