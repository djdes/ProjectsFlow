import type { Task } from '../../domain/task/Task.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskCommitRepository } from './TaskCommitRepository.js';
import type { TaskAttachmentRepository } from './TaskAttachmentRepository.js';
import type { TaskCommentRepository } from './TaskCommentRepository.js';
import type { TaskDelegationRepository } from './TaskDelegationRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly taskCommits: TaskCommitRepository;
  readonly attachments: TaskAttachmentRepository;
  readonly comments: TaskCommentRepository;
  readonly delegations: TaskDelegationRepository;
};

export type TaskWithCounts = Task & {
  readonly commitCount: number;
  readonly attachmentCount: number;
  readonly commentCount: number;
};

export class ListTasks {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, ownerUserId: string): Promise<TaskWithCounts[]> {
    const { project } = await requireProjectAccess(
      this.deps,
      projectId,
      ownerUserId,
      'read_project',
    );
    let tasks = await this.deps.tasks.listByProject(projectId);

    // Inbox-делегата: если caller-owner запрашивает свой inbox, добавим в результат
    // задачи, которые ему делегированы (accepted) из чужих inbox-проектов. Без этого
    // делегат не увидит принятую задачу в своих «Входящих» — она физически живёт
    // в inbox создателя.
    if (project.isInbox && project.ownerId === ownerUserId) {
      const delegatedToMe = await this.deps.tasks.listAcceptedDelegatedTo(ownerUserId);
      tasks = [...tasks, ...delegatedToMe];
    }

    const ids = tasks.map((t) => t.id);
    const commitCounts = await this.deps.taskCommits.countsByTasks(ids);
    const attachmentCounts = await this.deps.attachments.countsByTasks(ids);
    const commentCounts = await this.deps.comments.countsByTasks(ids);
    // Активные (pending|accepted) делегации — для inbox-задач. Для проектных
    // задач map будет пустой (мы их не делегируем — см. spec out-of-scope).
    const delegations = await this.deps.delegations.listActiveForTasks(ids);
    return tasks.map((t) => ({
      ...t,
      commitCount: commitCounts.get(t.id) ?? 0,
      attachmentCount: attachmentCounts.get(t.id) ?? 0,
      commentCount: commentCounts.get(t.id) ?? 0,
      delegation: delegations.get(t.id) ?? null,
    }));
  }
}
