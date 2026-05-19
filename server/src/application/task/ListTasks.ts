import type { Task } from '../../domain/task/Task.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskCommitRepository } from './TaskCommitRepository.js';
import type { TaskAttachmentRepository } from './TaskAttachmentRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly taskCommits: TaskCommitRepository;
  readonly attachments: TaskAttachmentRepository;
};

export type TaskWithCounts = Task & {
  readonly commitCount: number;
  readonly attachmentCount: number;
};

export class ListTasks {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, ownerUserId: string): Promise<TaskWithCounts[]> {
    await requireProjectAccess(this.deps, projectId, ownerUserId, 'read_project');
    const tasks = await this.deps.tasks.listByProject(projectId);
    const ids = tasks.map((t) => t.id);
    const commitCounts = await this.deps.taskCommits.countsByTasks(ids);
    const attachmentCounts = await this.deps.attachments.countsByTasks(ids);
    return tasks.map((t) => ({
      ...t,
      commitCount: commitCounts.get(t.id) ?? 0,
      attachmentCount: attachmentCounts.get(t.id) ?? 0,
    }));
  }
}
