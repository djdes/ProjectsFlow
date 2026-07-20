import { requireProjectAccess, type ProjectAccessDeps } from '../project/projectAccess.js';
import {
  MAX_WORKFLOWS_PER_PROJECT,
  WorkflowLimitError,
  WorkflowRuleNotFoundError,
  normalizeWorkflowAction,
  normalizeWorkflowName,
  normalizeWorkflowTrigger,
  type WorkflowAction,
  type WorkflowRule,
  type WorkflowTrigger,
} from '../../domain/automation/WorkflowRule.js';

export type CreateWorkflowInput = {
  readonly name: unknown;
  readonly trigger: unknown;
  readonly action: unknown;
};

export type UpdateWorkflowInput = {
  readonly name?: unknown;
  readonly trigger?: unknown;
  readonly action?: unknown;
  readonly enabled?: unknown;
};

// Порт хранилища правил (db/139). Реализация — DrizzleProjectWorkflowRepository. Один порт на
// ManageWorkflows (CRUD) и RunWorkflow (чтение включённых + auto-disable + журнал запусков).
export interface ProjectWorkflowRepository {
  listByProject(projectId: string): Promise<readonly WorkflowRule[]>;
  getById(projectId: string, id: string): Promise<WorkflowRule | null>;
  countByProject(projectId: string): Promise<number>;
  insert(rule: WorkflowRule): Promise<void>;
  update(
    projectId: string,
    id: string,
    patch: {
      readonly name?: string;
      readonly trigger?: WorkflowTrigger;
      readonly action?: WorkflowAction;
      readonly enabled?: boolean;
    },
  ): Promise<WorkflowRule | null>;
  delete(projectId: string, id: string): Promise<boolean>;
  // Гашение правила по id (RunWorkflow при зацикливании). Без projectId — вызывается изнутри
  // движка над уже прочитанным правилом, projectId уже известен и проверен.
  setEnabled(id: string, enabled: boolean): Promise<void>;
  // Итог последнего запуска для журнала в UI. Best-effort — запуск не падает из-за журнала.
  recordRun(id: string, status: string, at: string): Promise<void>;
}

type Deps = ProjectAccessDeps & {
  readonly workflows: ProjectWorkflowRepository;
  readonly idGen: () => string;
  readonly now?: () => Date;
};

// Управление правилами «событие → действие». Все операции требуют update_project:
// правило может делегировать задачи и слать наружу — это админ-уровень конфигурации.
export class ManageWorkflows {
  constructor(private readonly deps: Deps) {}

  private clock(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  async list(projectId: string, userId: string): Promise<readonly WorkflowRule[]> {
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    return this.deps.workflows.listByProject(projectId);
  }

  async create(
    projectId: string,
    userId: string,
    input: CreateWorkflowInput,
  ): Promise<WorkflowRule> {
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    const name = normalizeWorkflowName(input.name);
    const trigger = normalizeWorkflowTrigger(input.trigger);
    const action = normalizeWorkflowAction(input.action);
    const count = await this.deps.workflows.countByProject(projectId);
    if (count >= MAX_WORKFLOWS_PER_PROJECT) throw new WorkflowLimitError(MAX_WORKFLOWS_PER_PROJECT);
    const rule: WorkflowRule = {
      id: this.deps.idGen(),
      projectId,
      name,
      trigger,
      action,
      enabled: true,
      lastStatus: null,
      lastRunAt: null,
      createdAt: this.clock().toISOString(),
    };
    await this.deps.workflows.insert(rule);
    return rule;
  }

  async update(
    projectId: string,
    userId: string,
    id: string,
    input: UpdateWorkflowInput,
  ): Promise<WorkflowRule> {
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    const patch: {
      name?: string;
      trigger?: WorkflowTrigger;
      action?: WorkflowAction;
      enabled?: boolean;
    } = {};
    if (input.name !== undefined) patch.name = normalizeWorkflowName(input.name);
    if (input.trigger !== undefined) patch.trigger = normalizeWorkflowTrigger(input.trigger);
    if (input.action !== undefined) patch.action = normalizeWorkflowAction(input.action);
    if (input.enabled !== undefined) patch.enabled = Boolean(input.enabled);
    const updated = await this.deps.workflows.update(projectId, id, patch);
    if (!updated) throw new WorkflowRuleNotFoundError();
    return updated;
  }

  async remove(projectId: string, userId: string, id: string): Promise<void> {
    await requireProjectAccess(this.deps, projectId, userId, 'update_project');
    const deleted = await this.deps.workflows.delete(projectId, id);
    if (!deleted) throw new WorkflowRuleNotFoundError();
  }
}
