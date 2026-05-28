import type {
  TaskDelegation,
  TaskDelegationStatus,
} from '../../domain/task/TaskDelegation.js';

export type CreateDelegationInput = {
  readonly id: string;
  readonly taskId: string;
  readonly delegateUserId: string;
};

// Pending-делегация для блока «делегировано мне» сверху inbox. Включает превью
// описания задачи (joined) чтобы UI не делал второй fetch для рендера списка.
export type DelegationWithTaskInfo = TaskDelegation & {
  readonly taskExcerpt: string;
};

export interface TaskDelegationRepository {
  // Создаёт row со status='pending'. Уникальность активной делегации (=одна pending|accepted
  // на task) проверяется в application через findActiveForTask до insert.
  create(input: CreateDelegationInput): Promise<TaskDelegation>;
  // Активная (pending|accepted) делегация для задачи. null если нет.
  findActiveForTask(taskId: string): Promise<TaskDelegation | null>;
  // По id (любой статус). null если не существует.
  getById(id: string): Promise<TaskDelegation | null>;
  // Обновляет status + responded_at = NOW(). Возвращает обновлённую запись.
  setStatus(id: string, status: TaskDelegationStatus): Promise<TaskDelegation | null>;
  // Список pending для конкретного делегата — для верхнего блока в inbox.
  listPendingForDelegate(userId: string): Promise<DelegationWithTaskInfo[]>;
  // Активные делегации для набора taskId — для list-tasks join'а.
  listActiveForTasks(
    taskIds: readonly string[],
  ): Promise<Map<string, TaskDelegation>>;
}
