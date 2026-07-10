import {
  NotCreatorError,
  SelfDelegationError,
  TaskNotFoundError,
} from '../../domain/task/errors.js';
import { can } from '../../domain/project/permissions.js';
import type { Task } from '../../domain/task/Task.js';
import type { TaskDelegation } from '../../domain/task/TaskDelegation.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskDelegationRepository } from './TaskDelegationRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { NotificationRepository } from '../notifications/NotificationRepository.js';
import type { EmailSender } from '../notifications/EmailSender.js';
import { renderDelegationEmail } from '../notifications/emails/delegationEmail.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly delegations: TaskDelegationRepository;
  readonly users: UserRepository;
  readonly notifications: NotificationRepository;
  readonly email: EmailSender;
  readonly idGen: () => string;
  readonly appUrl: string;
};

// Пригласить+делегировать: перетащили задачу на человека, которого НЕТ в проекте (drag на
// кубик во «Входящих» → подтверждение «пригласить?»). В отличие от ReassignTaskDelegation
// (падает на не-участнике) — здесь создаётся делегация pending_invite: приглашённый увидит
// её во «Входящих» с «Вступить/Отклонить». Примет → вступит в проект + accepted; откажется →
// declined + откат ответственного на прежнего исполнителя (db/101, см. Decline/Accept).
//
// Если человек ВСЁ ЖЕ участник (гонка / уже добавили) — создаём обычную pending-делегацию.
// Авторизация как у reassign: делегатор (owner inbox / editor+ проекта) ИЛИ текущий делегат.
export class InviteAndDelegateTask {
  constructor(private readonly deps: Deps) {}

  async execute(
    taskId: string,
    delegateUserId: string,
    callerUserId: string,
  ): Promise<TaskDelegation> {
    if (delegateUserId === callerUserId) throw new SelfDelegationError();

    const task = await this.deps.tasks.getById(taskId);
    if (!task) throw new TaskNotFoundError(taskId);
    const project = await this.deps.projects.getById(task.projectId);
    if (!project) throw new TaskNotFoundError(taskId);

    const active = await this.deps.delegations.findActiveForTask(taskId);
    if (active && active.delegateUserId === delegateUserId) return active; // уже на нём
    const isCurrentDelegate = active?.delegateUserId === callerUserId;

    // Авторизация + определяем, участник ли уже приглашаемый (тогда обычная делегация).
    let alreadyMember: boolean;
    if (project.isInbox) {
      if (project.ownerId !== callerUserId && !isCurrentDelegate) throw new NotCreatorError();
      const shared = await this.deps.members.listSharedUsers(project.ownerId);
      alreadyMember = shared.some((u) => u.id === delegateUserId);
    } else {
      if (!isCurrentDelegate) {
        await requireProjectAccess(this.deps, project.id, callerUserId, 'delegate_task');
      }
      const membership = await this.deps.members.findForProject(project.id, delegateUserId);
      alreadyMember = Boolean(membership && can(membership.role, 'move_task'));
    }

    // Кого восстановить, если приглашённый откажется вступать — прежний активный исполнитель.
    const revertTo = active?.delegateUserId ?? null;
    if (active) await this.deps.delegations.setStatus(active.id, 'archived');

    const created = await this.deps.delegations.create({
      id: this.deps.idGen(),
      taskId,
      delegateUserId,
      delegatorUserId: callerUserId,
      status: alreadyMember ? 'pending' : 'pending_invite',
      revertToUserId: alreadyMember ? null : revertTo,
    });

    void this.notifyInvited(created, task, callerUserId).catch((err: unknown) => {
      console.error('[delegation:invite] notify failed:', err);
    });

    return created;
  }

  private async notifyInvited(
    delegation: TaskDelegation,
    task: Task,
    callerUserId: string,
  ): Promise<void> {
    const [delegate, creator] = await Promise.all([
      this.deps.users.getById(delegation.delegateUserId),
      this.deps.users.getById(callerUserId),
    ]);
    if (!delegate) return;

    const taskExcerpt = (task.description ?? '').slice(0, 120);
    const actorDisplayName = creator?.displayName ?? 'Кто-то';
    const inboxUrl = `${this.deps.appUrl.replace(/\/$/, '')}/inbox#delegation=${delegation.id}`;

    await this.deps.notifications.create({
      id: this.deps.idGen(),
      userId: delegate.id,
      payload: {
        type: 'task_delegation',
        delegationId: delegation.id,
        taskId: delegation.taskId,
        taskExcerpt,
        actorUserId: callerUserId,
        actorDisplayName,
      },
    });

    const message = renderDelegationEmail({
      to: delegate.email,
      actorDisplayName,
      taskExcerpt,
      inboxUrl,
    });
    await this.deps.email.send(message);
  }
}
