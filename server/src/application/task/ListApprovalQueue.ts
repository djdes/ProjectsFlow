import { can } from '../../domain/project/permissions.js';
import type { Project } from '../../domain/project/Project.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ResolveActiveWorkspace } from '../workspace/activeWorkspace.js';
import type { WorkspaceRepository } from '../workspace/WorkspaceRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { TaskAttachmentRepository } from './TaskAttachmentRepository.js';
import type { TaskCommentRepository } from './TaskCommentRepository.js';
import type { TaskCommitRepository } from './TaskCommitRepository.js';
import type { TaskRepository } from './TaskRepository.js';
import type { AssignedTaskView } from './ListTasksAssignedToMe.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly workspaces: WorkspaceRepository;
  readonly tasks: TaskRepository;
  readonly taskCommits: TaskCommitRepository;
  readonly attachments: TaskAttachmentRepository;
  readonly comments: TaskCommentRepository;
  readonly resolveActiveWorkspace: ResolveActiveWorkspace;
  readonly users: UserRepository;
};

/**
 * Очередь приёмки руководителя: все задачи «На утверждении» АКТИВНОГО пространства, которые
 * он вправе принять.
 *
 * Раньше полка «На утверждении» собиралась из списков «Мне» / «Другим» / «Личные коллег» —
 * то есть только из задач, где руководитель исполнитель или сам их поставил. Задача, которую
 * поставил владелец пространства или сотрудник сам себе, уходила на утверждение
 * (TaskApprovalService), руководителю приходило уведомление, а на полке её не было: принять
 * работу было негде, и она висела у сотрудника «Ждёт решения руководителя».
 *
 * Кто видит: только lead/owner пространства — та же граница, что TaskApprovalService.canApprove.
 * Остальным — пустой список, а не ошибка: клиент спрашивает очередь на общем экране.
 *
 * Что видит — ровно то, что может принять (MoveTask → requireTaskModifyAccess):
 *  - личные задачи — по одной, как принимающий (isInboxApprover в taskAuthorization); сам
 *    приватный проект «Входящих» при этом не раскрывается;
 *  - задачи именованных проектов — где у него есть право двигать задачи (move_task).
 */
export class ListApprovalQueue {
  constructor(private readonly deps: Deps) {}

  async execute(callerId: string): Promise<AssignedTaskView[]> {
    const ws = await this.deps.resolveActiveWorkspace(callerId);
    if (!ws) return [];
    const membership = await this.deps.workspaces.getMembership(ws.id, callerId);
    if (!membership || (membership.role !== 'lead' && membership.role !== 'owner')) return [];

    const pending = await this.deps.tasks.listByStatusInWorkspace(ws.id, 'pending_approval');
    if (pending.length === 0) return [];

    const projectIds = [...new Set(pending.map((t) => t.projectId))];
    const projectEntries = await Promise.all(
      projectIds.map(async (id) => [id, await this.deps.projects.getById(id)] as const),
    );
    const projectById = new Map(
      projectEntries.filter((e): e is [string, Project] => e[1] !== null && e[1].workspaceId === ws.id),
    );
    const allowed = new Map(
      await Promise.all(
        [...projectById.values()].map(async (project) => [project.id, await this.canAccept(project, callerId)] as const),
      ),
    );
    const visible = pending.filter((t) => allowed.get(t.projectId) === true);
    if (visible.length === 0) return [];

    const ids = visible.map((t) => t.id);
    const inboxOwnerIds = [
      ...new Set(
        visible
          .map((t) => projectById.get(t.projectId)!)
          .filter((p) => p.isInbox)
          .map((p) => p.ownerId),
      ),
    ];
    const [commitCounts, attachmentCounts, commentCounts, inboxOwners] = await Promise.all([
      this.deps.taskCommits.countsByTasks(ids),
      this.deps.attachments.countsByTasks(ids),
      this.deps.comments.countsByTasks(ids),
      Promise.all(inboxOwnerIds.map((id) => this.deps.users.getById(id))),
    ]);
    const inboxOwnerNames = new Map(
      inboxOwners.filter((u) => u !== null).map((u) => [u.id, u.displayName]),
    );

    return visible.map((task) => {
      const project = projectById.get(task.projectId)!;
      return {
        task,
        projectId: project.id,
        projectName: project.name,
        isInbox: project.isInbox,
        inboxOwner: project.isInbox
          ? { userId: project.ownerId, displayName: inboxOwnerNames.get(project.ownerId) ?? '' }
          : null,
        // В очередь попадает только то, что руководитель вправе принять.
        canModify: true,
        commitCount: commitCounts.get(task.id) ?? 0,
        attachmentCount: attachmentCounts.get(task.id) ?? 0,
        commentCount: commentCounts.get(task.id) ?? 0,
      };
    });
  }

  private async canAccept(project: Project, callerId: string): Promise<boolean> {
    if (await this.deps.members.isProjectHidden?.(project.id, callerId)) return false;
    // Личная задача: руководитель пространства — принимающий (см. isInboxApprover).
    if (project.isInbox) return true;
    const membership = await this.deps.members.findForProject(project.id, callerId);
    return membership !== null && can(membership.role, 'move_task');
  }
}
