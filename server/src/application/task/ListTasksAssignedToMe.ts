import type { Task } from '../../domain/task/Task.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ResolveActiveWorkspace } from '../workspace/activeWorkspace.js';
import type { TaskAttachmentRepository } from './TaskAttachmentRepository.js';
import type { TaskCommentRepository } from './TaskCommentRepository.js';
import type { TaskCommitRepository } from './TaskCommitRepository.js';
import type { TaskRepository } from './TaskRepository.js';
import type { UserRepository } from '../user/UserRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly taskCommits: TaskCommitRepository;
  readonly attachments: TaskAttachmentRepository;
  readonly comments: TaskCommentRepository;
  readonly resolveActiveWorkspace: ResolveActiveWorkspace;
  readonly users: UserRepository;
};

// Строка верхнего канбана: задача с обязательным assignee + контекст проекта.
export type AssignedTaskView = {
  readonly task: Task;
  readonly projectId: string;
  readonly projectName: string;
  readonly isInbox: boolean;
  readonly canModify: boolean;
  // Владелец личных входящих, в которых лежит задача (null у именованных проектов).
  // Нужен, чтобы UI подписывал «Личные · <имя>» и не выдавал чужую задачу за свою.
  readonly inboxOwner: { readonly userId: string; readonly displayName: string } | null;
  readonly commitCount: number;
  readonly attachmentCount: number;
  readonly commentCount: number;
};

// Все задачи, за которые сейчас отвечает caller. createdBy/кто назначил не участвуют.
export class ListTasksAssignedToMe {
  constructor(private readonly deps: Deps) {}

  async execute(userId: string): Promise<AssignedTaskView[]> {
    const ws = await this.deps.resolveActiveWorkspace(userId);
    if (!ws) return [];
    // Дефолт-хаб → все мои задачи; team → только задачи проектов активного пространства
    // (личный inbox живёт в хабе, поэтому в team-срез не попадает — как и в сайдбаре).
    const taskList =
      ws.kind === 'default'
        ? await this.deps.tasks.listAssignedTo(userId)
        : await this.deps.tasks.listAssignedToInWorkspace(userId, ws.id);
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

    // Имена владельцев чужих inbox'ов — по одному запросу на юзера, не на задачу.
    const inboxOwnerIds = [
      ...new Set(
        [...projectById.values()].filter((p) => p.isInbox).map((p) => p.ownerId),
      ),
    ];
    const inboxOwnerNames = new Map(
      (await Promise.all(inboxOwnerIds.map((id) => this.deps.users.getById(id))))
        .filter((u) => u !== null)
        .map((u) => [u.id, u.displayName]),
    );

    return visible.map((task) => {
      const project = projectById.get(task.projectId)!;
      return {
        task,
        projectId: task.projectId,
        projectName: project.name,
        isInbox: project.isInbox,
        inboxOwner: project.isInbox
          ? {
              userId: project.ownerId,
              displayName: inboxOwnerNames.get(project.ownerId) ?? '',
            }
          : null,
        // Текущий ответственный получает task-scoped modify даже с viewer-ролью.
        canModify: true,
        commitCount: commitCounts.get(task.id) ?? 0,
        attachmentCount: attachmentCounts.get(task.id) ?? 0,
        commentCount: commentCounts.get(task.id) ?? 0,
      };
    });
  }
}
