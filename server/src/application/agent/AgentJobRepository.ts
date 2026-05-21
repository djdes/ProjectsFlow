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

export type PendingAgentJob = {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly gitRepoUrl: string | null;
  readonly taskId: string;
  readonly taskDescription: string | null;
  readonly createdAt: Date;
};

export type AgentJobRepository = {
  /**
   * Атомарно создаёт agent-job И ставит `tasks.delegated_to_agent = true`
   * для соответствующей задачи. Обе операции в одной DB-транзакции.
   * Используется EnqueueAgentJob use-case'ом.
   */
  createForDelegation(input: NewAgentJobInput): Promise<AgentJob>;
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
   * Все queued job'ы по проектам, где `userId` — member. Сортировка по createdAt asc.
   * Limit — для UI/MCP (≈10-50). Возвращает обогащённые pending-DTO'шки с inline
   * project name + git URL + task description, чтобы избежать N+1 запросов.
   */
  listPendingForUser(userId: string, limit: number): Promise<PendingAgentJob[]>;
  /**
   * Атомарный claim — UPDATE WHERE id=? AND status='queued' SET status='running',
   * claimed_at=NOW(), started_at=NOW(). Возвращает обновлённую job если apply удался,
   * либо null (уже claim'нута / отменена / не существует).
   */
  claimById(jobId: string): Promise<AgentJob | null>;
  markStarted(id: string): Promise<void>;
  complete(id: string, result: CompleteAgentJobInput): Promise<void>;
  cancel(id: string, reason: string): Promise<void>;
};
