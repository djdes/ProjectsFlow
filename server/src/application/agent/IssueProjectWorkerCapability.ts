import type { AgentToken } from '../../domain/agent/AgentToken.js';
import {
  AgentCapabilityForbiddenError,
  AgentCapabilityTaskMismatchError,
} from '../../domain/agent/errors.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { CreateAgentToken, CreateAgentTokenResult } from './CreateAgentToken.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly createToken: CreateAgentToken;
  readonly now?: () => Date;
};

export type IssueProjectWorkerCapabilityCommand = {
  readonly userId: string;
  readonly parentToken: AgentToken;
  readonly projectId: string;
  readonly taskId: string | null;
  readonly ttlSeconds?: number;
};

export type ProjectWorkerCapabilityResult = CreateAgentTokenResult & {
  readonly expiresAt: Date;
};

const DEFAULT_TTL_SECONDS = 12 * 60 * 60;
const MIN_TTL_SECONDS = 5 * 60;
const MAX_TTL_SECONDS = 24 * 60 * 60;

export class IssueProjectWorkerCapability {
  constructor(private readonly deps: Deps) {}

  async execute(
    input: IssueProjectWorkerCapabilityCommand,
  ): Promise<ProjectWorkerCapabilityResult> {
    if (
      input.parentToken.userId !== input.userId ||
      input.parentToken.scopeKind !== 'account'
    ) {
      throw new AgentCapabilityForbiddenError();
    }

    const project = await this.deps.projects.getById(input.projectId);
    if (!project || project.dispatcherUserId !== input.userId) {
      throw new AgentCapabilityForbiddenError();
    }

    if (input.taskId) {
      const task = await this.deps.tasks.getById(input.taskId);
      if (!task || task.projectId !== input.projectId) {
        throw new AgentCapabilityTaskMismatchError();
      }
    }

    const requestedTtl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
    const ttlSeconds = Math.max(MIN_TTL_SECONDS, Math.min(MAX_TTL_SECONDS, requestedTtl));
    const expiresAt = new Date((this.deps.now?.() ?? new Date()).getTime() + ttlSeconds * 1000);
    const taskSuffix = input.taskId ? `:${input.taskId.slice(0, 8)}` : ':project';
    const result = await this.deps.createToken.execute({
      userId: input.userId,
      name: `worker:${input.projectId.slice(0, 8)}${taskSuffix}`,
      scope: {
        kind: 'project',
        projectId: input.projectId,
        taskId: input.taskId,
        parentTokenId: input.parentToken.id,
        expiresAt,
      },
    });
    return { ...result, expiresAt };
  }
}
