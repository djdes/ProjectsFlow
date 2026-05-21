import type { AgentJob, AgentJobStatus } from '../../domain/agent/AgentJob.js';

export type NewAgentJobInput = {
  projectId: string;
  taskId: string;
  createdBy: string;
};

export type CompleteAgentJobInput = {
  status: Extract<AgentJobStatus, 'succeeded' | 'failed'>;
  error?: string | null;
  prUrl?: string | null;
  branchName?: string | null;
};

export type AgentJobRepository = {
  create(input: NewAgentJobInput): Promise<AgentJob>;
  findById(id: string): Promise<AgentJob | null>;
  findActiveByTaskId(taskId: string): Promise<AgentJob | null>;
  /**
   * Все job'ы проекта, новые первыми. Limit для UI (≈50 хватит).
   */
  listForProject(projectId: string, limit: number): Promise<AgentJob[]>;
  /**
   * Map taskId → активная job (queued или running). Используется при загрузке
   * списка задач проекта чтобы не делать N+1 запросов. Активная job ровно одна
   * на task (uniqueness обеспечивается на уровне use-case'а enqueue).
   */
  findActiveByTaskIds(taskIds: readonly string[]): Promise<Map<string, AgentJob>>;
  /**
   * Атомарный claim — реализация в Plan B. В Plan A метод объявляем для полноты
   * порта, но не вызываем нигде.
   */
  claimNext(globalCap: number, runnerPid: number): Promise<AgentJob | null>;
  markStarted(id: string): Promise<void>;
  complete(id: string, result: CompleteAgentJobInput): Promise<void>;
  cancel(id: string, reason: string): Promise<void>;
};
