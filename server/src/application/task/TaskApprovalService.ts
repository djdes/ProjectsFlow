import type { Project } from '../../domain/project/Project.js';
import type { Task, TaskStatus } from '../../domain/task/Task.js';
import type { EmailSender } from '../notifications/EmailSender.js';
import { renderTaskApprovalEmail } from '../notifications/emails/taskApprovalEmail.js';
import type { NotificationRepository } from '../notifications/NotificationRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { WorkspaceRepository } from '../workspace/WorkspaceRepository.js';

type Deps = {
  readonly workspaces: WorkspaceRepository;
  readonly users: UserRepository;
  readonly notifications: NotificationRepository;
  readonly email: EmailSender;
  readonly idGen: () => string;
  readonly appUrl: string;
};

// Приёмка задач руководителем (db/150, включена по умолчанию с db/151).
//
// Одна политика на все пути закрытия задачи. Раньше гейт жил внутри MoveTask, но задачу
// закрывают и системные потоки (подтверждение close-proposal, авто-закрытие по коммиту,
// «Готово» из Telegram-композера) — они шли мимо, и работа исполнителя утверждение не
// проходила. Теперь решение о статусе принимается здесь, и все вызывают одно и то же.
export class TaskApprovalService {
  constructor(private readonly deps: Deps) {}

  // Какой статус реально записать вместо запрошенного. Подменяем только 'done' и только
  // когда закрывающий не вправе принимать работу сам.
  async resolveTargetStatus(
    project: Project,
    actorUserId: string,
    requested: TaskStatus,
  ): Promise<TaskStatus> {
    if (requested !== 'done') return requested;
    return (await this.requiresApproval(project, actorUserId)) ? 'pending_approval' : 'done';
  }

  // Вправе ли актор принимать работу в этом пространстве (руководитель/владелец).
  // Отдельно от resolveTargetStatus — нужен там, где решают, показывать ли приёмку.
  async canApprove(project: Project, actorUserId: string): Promise<boolean> {
    const membership = await this.deps.workspaces.getMembership(project.workspaceId, actorUserId);
    // Роли нет вовсе — это admin-bypass (системный админ вне пространства): у него прав
    // больше, чем у участника, поэтому приёмку он не проходит.
    if (!membership) return true;
    return membership.role === 'lead' || membership.role === 'owner';
  }

  private async requiresApproval(project: Project, actorUserId: string): Promise<boolean> {
    // Личные «Входящие» приёмку не проходят: свою задачу утверждать не у кого.
    if (project.isInbox) return false;
    const workspace = await this.deps.workspaces.getById(project.workspaceId);
    if (!workspace?.requireTaskApproval) return false;
    return !(await this.canApprove(project, actorUserId));
  }

  // Уведомить тех, кто принимает работу. Задача, попавшая в очередь приёмки, иначе ждёт,
  // пока руководитель сам заглянет в неё, — а это ровно та слепая зона, из-за которой
  // приёмку и заводили. Best-effort: падение уведомления не должно ломать перенос задачи.
  async notifyApprovalRequested(input: {
    task: Task;
    project: Project;
    actorUserId: string;
  }): Promise<void> {
    const { task, project, actorUserId } = input;
    const members = await this.deps.workspaces.listMembers(project.workspaceId);
    const approverIds = members
      .filter((m) => m.role === 'lead' || m.role === 'owner')
      // Себе не пишем: если работу отправил сам руководитель, уведомление бессмысленно.
      .filter((m) => m.userId !== actorUserId)
      .map((m) => m.userId);
    if (approverIds.length === 0) return;

    const actor = await this.deps.users.getById(actorUserId);
    const actorDisplayName = actor?.displayName ?? 'Участник';
    const taskExcerpt = (task.description ?? '').slice(0, 120);
    const base = this.deps.appUrl.replace(/\/$/u, '');
    const taskUrl = `${base}/projects/${project.id}`;

    for (const userId of approverIds) {
      await this.deps.notifications.create({
        id: this.deps.idGen(),
        userId,
        payload: {
          type: 'task_approval_requested',
          taskId: task.id,
          projectId: project.id,
          projectName: project.name,
          taskExcerpt,
          actorUserId,
          actorDisplayName,
        },
      });
      const approver = await this.deps.users.getById(userId);
      if (!approver) continue;
      await this.deps.email.send(
        renderTaskApprovalEmail({
          to: approver.email,
          actorDisplayName,
          projectName: project.name,
          taskExcerpt,
          taskUrl,
        }),
      );
    }
  }
}
