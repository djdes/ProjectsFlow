import { hasOwnerRights } from '../../domain/project/permissions.js';
import { isSystemAdmin } from '../project/projectAccess.js';
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
// пространства юзера; team → срез по активному пространству; нет пространства → пусто.
export class ListTasksAssignedToOthers {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string, options?: { readonly excludeDone?: boolean }): Promise<AssignedTaskView[]> {
    const ws = await this.deps.resolveActiveWorkspace(userId);
    if (!ws) return [];
    const projects = (await this.deps.members.listProjectsForUserInWorkspace(userId, ws.id))
      // Проекты пространства, включая подключённые к нему общие проекты (db/182).
      .filter(
        (project) =>
          (project.workspaceId === ws.id || (project.sharedWorkspaces ?? []).some((w) => w.id === ws.id)) &&
          (!project.isInbox || project.ownerId === userId),
      );
    if (projects.length === 0) return [];
    const projectIds = projects.map((project) => project.id);
    const projectById = new Map(projects.map((project) => [project.id, project]));
    // Batch all workspace projects into one SQL read + one visibility pass instead of N+1
    // queries per project (big win on workspaces with 20+ projects). Preserve project order.
    const allTasks =
      typeof this.deps.tasks.listByProjects === 'function'
        ? await this.deps.tasks.listByProjects(projectIds, options)
        : (await Promise.all(projectIds.map((id) => this.deps.tasks.listByProject(id, options)))).flat();
    const otherTasks = allTasks.filter(
      (task) =>
        projectById.has(task.projectId) &&
        task.assignee.userId !== userId &&
        (!options?.excludeDone || task.status !== 'done'),
    );
    // Общие проекты (db/182): только задачи, видимые по правилам пространств и людей.
    const visibleTasks = this.deps.members.filterVisibleTasks
      ? await this.deps.members.filterVisibleTasks(userId, otherTasks)
      : otherTasks;
    const tasksByProject = new Map<string, typeof visibleTasks>();
    for (const task of visibleTasks) {
      const bucket = tasksByProject.get(task.projectId);
      if (bucket) bucket.push(task);
      else tasksByProject.set(task.projectId, [task]);
    }
    const flat = projects.flatMap((project) =>
      (tasksByProject.get(project.id) ?? []).map((task) => ({ task, project })),
    );
    const ids = flat.map(({ task }) => task.id);
    const [commitCounts, attachmentCounts, commentCounts] = await Promise.all([
      this.deps.taskCommits.countsByTasks(ids),
      this.deps.attachments.countsByTasks(ids, { includeCommentAttachments: true }),
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

    const isAdmin = await isSystemAdmin(userId);
    return flat.map(({ task, project }) => ({
      task,
      projectId: project.id,
      projectName: project.name,
      isInbox: project.isInbox,
      inboxOwner: project.isInbox
        ? { userId: project.ownerId, displayName: inboxOwnerNames.get(project.ownerId) ?? '' }
        : null,
      canModify: isAdmin || project.ownerId === userId || hasOwnerRights(project.role),
      commitCount: commitCounts.get(task.id) ?? 0,
      attachmentCount: attachmentCounts.get(task.id) ?? 0,
      commentCount: commentCounts.get(task.id) ?? 0,
    }));
  }
}
