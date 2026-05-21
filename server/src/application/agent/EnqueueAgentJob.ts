import type { AgentJob } from '../../domain/agent/AgentJob.js';
import {
  TaskAlreadyHasActiveAgentJobError,
  TaskMissingDescriptionError,
} from '../../domain/agent/errors.js';
import {
  InsufficientProjectRoleError,
  ProjectNotFoundError,
} from '../../domain/project/errors.js';
import { can } from '../../domain/project/permissions.js';
import { TaskNotFoundError } from '../../domain/task/errors.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { AgentJobRepository } from './AgentJobRepository.js';
import type { AgentRunnerSignal } from './AgentRunnerSignal.js';

export type EnqueueAgentJobInput = {
  userId: string;
  projectId: string;
  taskId: string;
};

type Deps = {
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly agentJobs: AgentJobRepository;
  readonly signal: AgentRunnerSignal;
};

export class EnqueueAgentJob {
  constructor(private readonly deps: Deps) {}

  async execute(input: EnqueueAgentJobInput): Promise<AgentJob> {
    // 1. Permissions
    const membership = await this.deps.members.findForProject(input.projectId, input.userId);
    if (!membership) throw new ProjectNotFoundError();
    if (!can(membership.role, 'delegate_task_to_agent')) {
      throw new InsufficientProjectRoleError(membership.role, 'delegate_task_to_agent');
    }

    // 2. Task exists and belongs to project
    const task = await this.deps.tasks.getById(input.taskId);
    if (!task || task.projectId !== input.projectId) {
      throw new TaskNotFoundError(input.taskId);
    }
    if (!task.description || task.description.trim().length === 0) {
      throw new TaskMissingDescriptionError(input.taskId);
    }

    // 3. No active job already
    const existing = await this.deps.agentJobs.findActiveByTaskId(input.taskId);
    if (existing) throw new TaskAlreadyHasActiveAgentJobError(input.taskId);

    // 4. Атомарно создаём job и ставим sticky-флаг delegated_to_agent
    const job = await this.deps.agentJobs.createForDelegation({
      projectId: input.projectId,
      taskId: input.taskId,
      createdBy: input.userId,
    });

    // 5. Best-effort wake runner (Plan A: noop)
    void this.deps.signal.notifyJobEnqueued().catch(() => {
      // Signal — optimization. Polling in Plan B will catch up.
    });

    return job;
  }
}
