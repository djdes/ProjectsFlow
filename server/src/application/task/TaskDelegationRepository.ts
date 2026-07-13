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
  // Статус создаваемой делегации. Все актуальные пути создают 'accepted'
  // (мгновенное делегирование, спека §4); дефолт 'pending' — легаси.
  readonly status?: TaskDelegationStatus;
  // Кому откатить ответственность при отказе от вступления (только для pending_invite).
  readonly revertToUserId?: string | null;
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

// Строка для вкладки «Другим»: то же, что AssignedDelegationRow (delegateRole — роль
// ДЕЛЕГАТА, для диагностики «делегата убрали из проекта»), плюс роль самого CALLER'а
// в проекте задачи — для видимости и расчёта canModify в use-case.
export type DelegatedToOthersRow = AssignedDelegationRow & {
  readonly callerRole: ProjectRole | null;
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
  // Все активные (pending|accepted) делегации «кому-то другому», ВИДИМЫЕ пользователю,
  // по всем проектам — вкладка «Другим». Видимость: участник именованного проекта видит
  // все делегирования в нём (от любого любому); inbox-строки — только собственные
  // (caller = делегатор; legacy-строки без delegator_user_id матчатся через owner
  // проекта, фолбэк как в toDomain). Строки, где делегат — сам caller, исключены (это
  // «Для меня»). Авторизация встроена в запрос.
  listDelegatedToOthers(userId: string): Promise<DelegatedToOthersRow[]>;
  // Активные делегации для набора taskId — для list-tasks join'а.
  listActiveForTasks(
    taskIds: readonly string[],
  ): Promise<Map<string, TaskDelegation>>;
}
