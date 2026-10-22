import type { TaskStatus } from '../../domain/task/Task.js';

const ACTIVE_STATUSES: readonly TaskStatus[] = ['todo', 'in_progress', 'awaiting_clarification'];

export class AgentTaskDispatchForbiddenError extends Error {
  constructor() {
    super('Передача задач воркеру через MCP запрещена. Запустить задачу может пользователь в интерфейсе или Telegram.');
    this.name = 'AgentTaskDispatchForbiddenError';
  }
}

// Agent credentials may report progress on an already delegated task, but cannot
// delegate another task or requeue it. Applies to old MCP clients and direct REST.
export function agentTaskCreateStatus(status: TaskStatus = 'backlog'): TaskStatus {
  if (ACTIVE_STATUSES.includes(status)) throw new AgentTaskDispatchForbiddenError();
  return status;
}

export function requireAgentTaskMove(current: TaskStatus | undefined, target: TaskStatus): void {
  if (target === 'todo' || (ACTIVE_STATUSES.includes(target) && (!current || !ACTIVE_STATUSES.includes(current)))) {
    throw new AgentTaskDispatchForbiddenError();
  }
}
