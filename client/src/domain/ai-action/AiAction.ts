import type { TaskPriority, TaskStatus } from '@/domain/task/Task';

// Действие плана всегда адресует проект: явным id, ссылкой на create_project внутри
// того же плана (projectRef) либо неявно — проектом открытой студии.
export type AiActionProjectTarget = { projectId?: string; projectRef?: string };

export type CreateProjectAction = { id: string; type: 'create_project'; name: string };
export type CreateTaskAction = AiActionProjectTarget & {
  id: string;
  type: 'create_task';
  description: string;
  status?: TaskStatus;
  deadline?: string | null;
  priority?: TaskPriority | null;
  assigneeUserId?: string;
};
export type UpdateTaskAction = AiActionProjectTarget & {
  id: string;
  type: 'update_task';
  taskId: string;
  description?: string;
  status?: TaskStatus;
  deadline?: string | null;
  priority?: TaskPriority | null;
};
export type DeleteTaskAction = AiActionProjectTarget & { id: string; type: 'delete_task'; taskId: string };
export type DeleteAllTasksAction = AiActionProjectTarget & { id: string; type: 'delete_all_tasks' };

export type AiAction =
  | CreateProjectAction
  | CreateTaskAction
  | UpdateTaskAction
  | DeleteTaskAction
  | DeleteAllTasksAction;

export type AiActionType = AiAction['type'];

export type AiActionPlan = { title: string; summary?: string; actions: AiAction[] };

// `create_project` — единственное действие без адресата: проект им и создаётся.
export function aiActionProjectTarget(action: AiAction): AiActionProjectTarget {
  if (action.type === 'create_project') return {};
  return { projectId: action.projectId, projectRef: action.projectRef };
}

// Уровень риска действия. 'safe' исполняется молча, 'destructive' проходит явный review
// со списком затрагиваемых объектов (reference/notion-ai-chat/behavior.md §1).
export type AiActionRisk = 'safe' | 'destructive';

// Разрушительным считается всё, что уничтожает пользовательские данные необратимо
// для конкретного объекта: точечное и массовое удаление задач. Создание и правка
// отдельных полей задачи откатываются журналом батча, поэтому review не требуют.
const DESTRUCTIVE_ACTION_TYPES: ReadonlySet<AiActionType> = new Set<AiActionType>([
  'delete_task',
  'delete_all_tasks',
]);

export function isDestructiveActionType(type: AiActionType): boolean {
  return DESTRUCTIVE_ACTION_TYPES.has(type);
}

export function aiActionRisk(action: AiAction): AiActionRisk {
  return isDestructiveActionType(action.type) ? 'destructive' : 'safe';
}

// Объект, который затронет разрушительное действие. Резолвится ДО решения пользователя,
// чтобы карточка review показывала названия, а не идентификаторы.
export type AiAffectedEntity = {
  readonly actionId: string;
  readonly kind: 'task' | 'project';
  readonly projectId: string;
  readonly entityId: string;
  readonly title: string;
};
