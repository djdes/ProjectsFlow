import type { Task } from '../../domain/task/Task.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskAttachmentRepository } from './TaskAttachmentRepository.js';
import type { TaskCommentRepository } from './TaskCommentRepository.js';
import type { TaskCommitRepository } from './TaskCommitRepository.js';
import type { TaskRepository } from './TaskRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly taskCommits: TaskCommitRepository;
  readonly attachments: TaskAttachmentRepository;
  readonly comments: TaskCommentRepository;
};

// Строка верхнего канбана: задача с обязательным assignee + контекст проекта.
export type AssignedTaskView = {
  readonly task: Task;
  readonly projectId: string;
  readonly projectName: string;
  readonly isInbox: boolean;
  readonly canModify: boolean;
  readonly commitCount: number;
  readonly attachmentCount: number;
  readonly commentCount: number;
};

// Все задачи, за которые сейчас отвечает caller. createdBy/кто назначил не участвуют.
export class ListTasksAssignedToMe {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<AssignedTaskView[]> {
    const taskList = await this.deps.tasks.listAssignedTo(userId);
    const projectIds = [...new Set(taskList.map((t) => t.projectId))];
    const contexts = await Promise.all(
      projectIds.map(async (projectId) => {
        const project = await this.deps.projects.getById(projectId);
        if (!project) return null;
        const membership = project.isInbox
          ? null
          : await this.deps.members.findForProject(projectId, userId);
        // Назначение в именованном проекте не должно обходить удаление из workspace.
        if (!project.isInbox && !membership) return null;
        return [projectId, project] as const;
      }),
    );
    const projectById = new Map(contexts.filter((x) => x !== null));
    const visible = taskList.filter((t) => projectById.has(t.projectId));
    const ids = visible.map((t) => t.id);
    const [commitCounts, attachmentCounts, commentCounts] = await Promise.all([
      this.deps.taskCommits.countsByTasks(ids),
      this.deps.attachments.countsByTasks(ids),
      this.deps.comments.countsByTasks(ids),
    ]);

    return visible.map((task) => {
      const project = projectById.get(task.projectId)!;
      return {
        task,
        projectId: task.projectId,
        projectName: project.name,
        isInbox: project.isInbox,
        // Текущий ответственный получает task-scoped modify даже с viewer-ролью.
        canModify: true,
        commitCount: commitCounts.get(task.id) ?? 0,
        attachmentCount: attachmentCounts.get(task.id) ?? 0,
        commentCount: commentCounts.get(task.id) ?? 0,
      };
    });
  }
}
