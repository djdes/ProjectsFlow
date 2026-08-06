import { can } from '../../domain/project/permissions.js';
import type { Project } from '../../domain/project/Project.js';
import { WorkspaceNotFoundError } from '../../domain/workspace/errors.js';
import { requireWorkspaceLead, requireWorkspaceMember } from '../workspace/workspaceAccess.js';
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
 * Доска сотрудника для руководителя пространства (BUG D).
 *
 * Раньше клик по кубику сотрудника показывал только его личные (inbox) задачи — картина
 * по человеку была неполной, проектные задачи не попадали в поле зрения. Решение владельца
 * продукта: руководитель видит ВСЕ незавершённые задачи сотрудника по всем проектам
 * АКТИВНОГО ПРОСТРАНСТВА, включая проекты, где сам руководитель не участник. Это
 * расширение доступа к данным, поэтому гейт строгий и явный:
 *
 *  - вызывающий обязан быть lead/owner активного пространства (WorkspaceRepository.getMembership,
 *    та же граница ролей, что в TaskApprovalService.canApprove);
 *  - memberId обязан быть участником ТОГО ЖЕ пространства (иначе 404, ничего не раскрываем);
 *  - скоуп задач — по workspace_id проектов (TaskRepository.listAssignedToInWorkspace,
 *    эталон изоляции — ListProjects.ts), а НЕ по членству вызывающего в конкретных проектах;
 *  - завершённые задачи ('done') не отдаём.
 *
 * canModify: личные (inbox) задачи сотрудника модерируемы любым со-участником пространства
 * (тот же принцип, что у ListPersonalTasksOfColleagues — право на действие совпадает с
 * правом на просмотр внутри общего пространства). Для именованных проектов — canModify
 * зависит от РЕАЛЬНОГО членства руководителя в этом конкретном проекте: если он не
 * участник, карточка read-only (false) — мы дали видимость, а не право редактировать
 * чужой проект без приглашения.
 */
export class ListMemberTasksForLead {
  constructor(private readonly deps: Deps) {}

  async execute(callerId: string, memberId: string): Promise<AssignedTaskView[]> {
    const ws = await this.deps.resolveActiveWorkspace(callerId);
    if (!ws) throw new WorkspaceNotFoundError();
    await requireWorkspaceLead(this.deps.workspaces, ws.id, callerId);
    await requireWorkspaceMember(this.deps.workspaces, ws.id, memberId);

    const taskList = (await this.deps.tasks.listAssignedToInWorkspace(memberId, ws.id)).filter(
      (t) => t.status !== 'done',
    );
    if (taskList.length === 0) return [];

    const projectIds = [...new Set(taskList.map((t) => t.projectId))];
    const projectEntries = await Promise.all(
      projectIds.map(async (id) => [id, await this.deps.projects.getById(id)] as const),
    );
    const projectById = new Map(
      projectEntries.filter((e): e is [string, Project] => e[1] !== null),
    );
    const visible = taskList.filter((t) => projectById.has(t.projectId));
    if (visible.length === 0) return [];

    const ids = visible.map((t) => t.id);
    const namedProjectIds = [
      ...new Set(visible.filter((t) => !projectById.get(t.projectId)!.isInbox).map((t) => t.projectId)),
    ];
    const [commitCounts, attachmentCounts, commentCounts, callerMemberships, member] = await Promise.all([
      this.deps.taskCommits.countsByTasks(ids),
      this.deps.attachments.countsByTasks(ids),
      this.deps.comments.countsByTasks(ids),
      Promise.all(
        namedProjectIds.map(
          async (id) => [id, await this.deps.members.findForProject(id, callerId)] as const,
        ),
      ),
      this.deps.users.getById(memberId),
    ]);
    const callerRoleByProject = new Map(callerMemberships);
    const memberName = member?.displayName ?? '';

    return visible.map((task) => {
      const project = projectById.get(task.projectId)!;
      const callerMembership = callerRoleByProject.get(project.id) ?? null;
      return {
        task,
        projectId: project.id,
        projectName: project.name,
        isInbox: project.isInbox,
        inboxOwner: project.isInbox
          ? { userId: project.ownerId, displayName: memberName }
          : null,
        canModify: project.isInbox
          ? true
          : callerMembership !== null && can(callerMembership.role, 'move_task'),
        commitCount: commitCounts.get(task.id) ?? 0,
        attachmentCount: attachmentCounts.get(task.id) ?? 0,
        commentCount: commentCounts.get(task.id) ?? 0,
      };
    });
  }
}
