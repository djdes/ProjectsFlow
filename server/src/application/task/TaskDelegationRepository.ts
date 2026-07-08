import type {
  TaskDelegation,
  TaskDelegationStatus,
} from '../../domain/task/TaskDelegation.js';
import type { ProjectRole } from '../../domain/project/ProjectMembership.js';

export type CreateDelegationInput = {
  readonly id: string;
  readonly taskId: string;
  readonly delegateUserId: string;
  // Кто делегирует. Required (compile-time): новые строки всегда знают делегатора.
  readonly delegatorUserId: string;
};

// Pending-делегация для блока «делегировано мне» сверху inbox. Включает превью
// описания задачи (joined) чтобы UI не делал второй fetch для рендера списка.
export type DelegationWithTaskInfo = TaskDelegation & {
  readonly taskExcerpt: string;
};

// Строка для блока «Поручено мне»: id задачи, её активная делегация на меня, контекст
// проекта (для группировки) + моя роль в этом проекте (для расчёта canModify в use-case).
// Полный Task use-case достаёт батчем через TaskRepository.listByIds (DRY — единый toTask).
// delegateRole = null для inbox-проекта (я не member) ИЛИ если меня убрали из именованного
// проекта — такие строки ListTasksAssignedToMe отбрасывает.
export type AssignedDelegationRow = {
  readonly taskId: string;
  readonly delegation: TaskDelegation;
  readonly projectId: string;
  readonly projectName: string;
  readonly isInbox: boolean;
  readonly delegateRole: ProjectRole | null;
};

// Строка для вкладки «Другим» (я — делегатор): то же, что AssignedDelegationRow
// (delegateRole — роль ДЕЛЕГАТА, для фильтра «делегата убрали из проекта»), плюс
// роль самого caller'а-делегатора — для расчёта canModify в use-case.
export type DelegatedByRow = AssignedDelegationRow & {
  readonly creatorRole: ProjectRole | null;
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
  // Все активные (pending|accepted) делегации НА этого пользователя, по всем проектам —
  // для блока «Поручено мне». Авторизация встроена (фильтр delegate_user_id = userId);
  // taskId извне НЕ принимается (защита от IDOR).
  listAssignedTo(userId: string): Promise<AssignedDelegationRow[]>;
  // Все активные (pending|accepted) делегации ОТ этого пользователя (он — делегатор), по
  // всем проектам — для вкладки «Другим». Legacy-строки без delegator_user_id матчатся
  // через owner проекта (тот же фолбэк, что в toDomain). Авторизация встроена.
  listDelegatedBy(userId: string): Promise<DelegatedByRow[]>;
  // Активные делегации для набора taskId — для list-tasks join'а.
  listActiveForTasks(
    taskIds: readonly string[],
  ): Promise<Map<string, TaskDelegation>>;
}
