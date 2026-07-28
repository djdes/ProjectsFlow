import { can } from '../../domain/project/permissions.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ResolveActiveWorkspace } from '../workspace/activeWorkspace.js';
import type { TaskAttachmentRepository } from './TaskAttachmentRepository.js';
import type { TaskCommentRepository } from './TaskCommentRepository.js';
import type { TaskCommitRepository } from './TaskCommitRepository.js';
import type { TaskRepository } from './TaskRepository.js';
import type { AssignedTaskView } from './ListTasksAssignedToMe.js';
import type { UserRepository } from '../user/UserRepository.js';

type Deps = {
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly taskCommits: TaskCommitRepository;
  readonly attachments: TaskAttachmentRepository;
  readonly comments: TaskCommentRepository;
  readonly resolveActiveWorkspace: ResolveActiveWorkspace;
  readonly users: UserRepository;
};

// Все видимые caller'у задачи, где ответственный — другой человек. Источник назначения
// и автор задачи не имеют значения. Охват — как в ListProjects: дефолт-хаб → все
// пространства юзера; team → срез по активному пространству; нет пространства → пусто.
export class ListTasksAssignedToOthers {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<AssignedTaskView[]> {
    const ws = await this.deps.resolveActiveWorkspace(userId);
    if (!ws) return [];
    const projects =
      ws.kind === 'default'
        ? await this.deps.members.listProjectsForUser(userId)
        : await this.deps.members.listProjectsForUserInWorkspace(userId, ws.id);
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

    // Имена владельцев inbox'ов — по одному запросу на юзера, не на задачу.
    const inboxOwnerIds = [
      ...new Set(flat.filter(({ project }) => project.isInbox).map(({ project }) => project.ownerId)),
    ];
    const inboxOwnerNames = new Map(
      (await Promise.all(inboxOwnerIds.map((id) => this.deps.users.getById(id))))
        .filter((u) => u !== null)
        .map((u) => [u.id, u.displayName]),
    );

    return flat.map(({ task, project }) => ({
      task,
      projectId: project.id,
      projectName: project.name,
      isInbox: project.isInbox,
      inboxOwner: project.isInbox
        ? { userId: project.ownerId, displayName: inboxOwnerNames.get(project.ownerId) ?? '' }
        : null,
      canModify: project.isInbox || can(project.role, 'move_task'),
      commitCount: commitCounts.get(task.id) ?? 0,
      attachmentCount: attachmentCounts.get(task.id) ?? 0,
      commentCount: commentCounts.get(task.id) ?? 0,
    }));
  }
}
