import { can } from '../../domain/project/permissions.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { TaskAttachmentRepository } from './TaskAttachmentRepository.js';
import type { TaskCommentRepository } from './TaskCommentRepository.js';
import type { TaskCommitRepository } from './TaskCommitRepository.js';
import type { TaskRepository } from './TaskRepository.js';
import type { AssignedTaskView } from './ListTasksAssignedToMe.js';

type Deps = {
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly taskCommits: TaskCommitRepository;
  readonly attachments: TaskAttachmentRepository;
  readonly comments: TaskCommentRepository;
};

// Все видимые caller'у задачи, где ответственный — другой человек. Источник назначения
// и автор задачи не имеют значения.
export class ListTasksAssignedToOthers {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<AssignedTaskView[]> {
    const projects = await this.deps.members.listProjectsForUser(userId);
    const rows = await Promise.all(
      projects.map(async (project) => ({
        project,
        tasks: (await this.deps.tasks.listByProject(project.id)).filter(
          (task) => task.assignee.userId !== userId,
        ),
      })),
    );
    const flat = rows.flatMap(({ project, tasks }) =>
      tasks.map((task) => ({ task, project })),
    );
    const ids = flat.map(({ task }) => task.id);
    const [commitCounts, attachmentCounts, commentCounts] = await Promise.all([
      this.deps.taskCommits.countsByTasks(ids),
      this.deps.attachments.countsByTasks(ids),
      this.deps.comments.countsByTasks(ids),
    ]);

    return flat.map(({ task, project }) => ({
      task,
      projectId: project.id,
      projectName: project.name,
      isInbox: project.isInbox,
      canModify: project.isInbox || can(project.role, 'move_task'),
      commitCount: commitCounts.get(task.id) ?? 0,
      attachmentCount: attachmentCounts.get(task.id) ?? 0,
      commentCount: commentCounts.get(task.id) ?? 0,
    }));
  }
}
