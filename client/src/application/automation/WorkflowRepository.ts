// Порт правил «событие → действие» проекта (срез 8 Workflows, db/139). Конструктор правил
// над существующими сущностями — НЕ общий workflow-движок. Триггеры и действия — замкнутые
// наборы, совпадают с серверными (domain/automation/WorkflowRule.ts). presentation импортирует
// эти типы; конкретный HttpWorkflowRepository живёт в infrastructure.

// Статусы задачи (для триггера task_status_changed). Совпадают с server TaskStatus.
export const WORKFLOW_TASK_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'awaiting_clarification',
  'done',
  'manual',
] as const;
export type WorkflowTaskStatus = (typeof WORKFLOW_TASK_STATUSES)[number];

// Приоритеты (для действия set_priority). 1=urgent … 4=low.
export const WORKFLOW_PRIORITIES = [1, 2, 3, 4] as const;
export type WorkflowPriority = (typeof WORKFLOW_PRIORITIES)[number];

// События исходящих вебхуков (для действия trigger_webhook). Совпадают с server WEBHOOK_EVENTS.
export const WORKFLOW_WEBHOOK_EVENTS = [
  'task.created',
  'task.updated',
  'task.status_changed',
  'task.deleted',
  'task.commented',
  'project.updated',
  'member.added',
  'member.removed',
] as const;
export type WorkflowWebhookEvent = (typeof WORKFLOW_WEBHOOK_EVENTS)[number];

export type WorkflowTrigger =
  | { readonly type: 'task_created' }
  | { readonly type: 'task_status_changed'; readonly status: WorkflowTaskStatus }
  | { readonly type: 'task_deadline_approaching'; readonly hoursBefore: number }
  | { readonly type: 'webhook_received'; readonly key: string };

export type WorkflowAction =
  | { readonly type: 'delegate'; readonly assigneeUserId: string }
  | { readonly type: 'set_priority'; readonly priority: WorkflowPriority }
  | { readonly type: 'send_telegram'; readonly message: string }
  | { readonly type: 'trigger_webhook'; readonly event: WorkflowWebhookEvent };

export type WorkflowRule = {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly trigger: WorkflowTrigger;
  readonly action: WorkflowAction;
  readonly enabled: boolean;
  readonly lastStatus: string | null;
  readonly lastRunAt: string | null;
  readonly createdAt: string;
};

export type CreateWorkflowInput = {
  readonly name: string;
  readonly trigger: WorkflowTrigger;
  readonly action: WorkflowAction;
};

export type UpdateWorkflowInput = {
  readonly name?: string;
  readonly trigger?: WorkflowTrigger;
  readonly action?: WorkflowAction;
  readonly enabled?: boolean;
};

export interface WorkflowRepository {
  list(projectId: string): Promise<readonly WorkflowRule[]>;
  create(projectId: string, input: CreateWorkflowInput): Promise<WorkflowRule>;
  update(projectId: string, id: string, patch: UpdateWorkflowInput): Promise<WorkflowRule>;
  remove(projectId: string, id: string): Promise<void>;
}
