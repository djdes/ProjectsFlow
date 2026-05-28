import type { RalphMode, Task, TaskPriority, TaskStatus } from '../../domain/task/Task.js';

export type CreateTaskInput = {
  readonly id: string;
  readonly projectId: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly position: number;
  // Режим работы Ralph (default 'normal'). См. domain RalphMode.
  readonly ralphMode?: RalphMode;
  // Срок выполнения (ISO 'YYYY-MM-DD'). null = без deadline.
  readonly deadline?: string | null;
  // Приоритет 1..4 (1=urgent, 4=low). null = без приоритета.
  readonly priority?: TaskPriority | null;
};

export type UpdateTaskPatch = {
  readonly description?: string | null;
  readonly status?: TaskStatus;
  readonly position?: number;
  readonly ralphMode?: RalphMode;
  // null = очистить deadline. undefined = не менять.
  readonly deadline?: string | null;
  // null = убрать приоритет. undefined = не менять.
  readonly priority?: TaskPriority | null;
};

export interface TaskRepository {
  listByProject(projectId: string): Promise<Task[]>;
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
  // Возвращает min/max позицию в колонке — для расчёта новой position при insert "сверху" / "снизу".
  getPositionBounds(projectId: string, status: TaskStatus): Promise<{ min: number; max: number } | null>;
  /**
   * Sticky-флаг «отдано агенту». В Plan A ставится транзакционно через
   * AgentJobRepository.createForDelegation. Этот метод оставлен для будущего
   * re-queue flow в Plan B (при failed → автоматически снова в очередь).
   */
  setDelegatedToAgent(taskId: string, value: boolean): Promise<void>;
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
   * tasks.project_id. Используется AssignInboxTaskToProject use-case'ом.
   * Position не пересчитываем — задача попадает в проект с её текущим position
   * и status (как правило 'todo'/'done'); UI отсортирует.
   */
  moveToProject(taskId: string, targetProjectId: string): Promise<Task | null>;
}
