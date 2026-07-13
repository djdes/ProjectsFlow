import {
  DelegateNotInSharedMembersError,
  DelegateNotProjectMemberError,
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

// Переназначить ответственного за уже делегированную задачу (drag'ом на кубик человека
// во «Входящих»). В отличие от DelegateExistingTask (создаёт первую делегацию и падает
// AlreadyDelegatedError, если активная есть) — здесь текущая активная делегация ЛЮБОГО
// статуса архивируется, и создаётся новая (сразу accepted). Область «Максимально»: переназначить
// может делегатор (владелец inbox / editor+ проекта) ИЛИ текущий делегат — «передать
// дальше» задачу, порученную ему. DB не гарантирует уникальность активной делегации
// (см. TaskDelegationRepository) — порядок archive→create держим здесь.
export class ReassignTaskDelegation {
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
    // Дроп на текущего делегата — ничего не меняем (не плодим архив/pending впустую).
    if (active && active.delegateUserId === delegateUserId) return active;
    const isCurrentDelegate = active?.delegateUserId === callerUserId;

    if (project.isInbox) {
      // Inbox: переназначает владелец инбокса или текущий делегат (передать дальше).
      // Новый делегат — из общих проектов ВЛАДЕЛЬЦА инбокса (он увидит задачу как
      // accepted-delegate, не будучи членом инбокса).
      if (project.ownerId !== callerUserId && !isCurrentDelegate) throw new NotCreatorError();
      const shared = await this.deps.members.listSharedUsers(project.ownerId);
      if (!shared.find((u) => u.id === delegateUserId)) {
        throw new DelegateNotInSharedMembersError();
      }
    } else {
      // Именованный проект: переназначает участник с правом delegate_task ИЛИ текущий
      // делегат. Новый делегат — участник-редактор этого проекта.
      if (!isCurrentDelegate) {
        await requireProjectAccess(this.deps, project.id, callerUserId, 'delegate_task');
      }
      const membership = await this.deps.members.findForProject(project.id, delegateUserId);
      if (!membership || !can(membership.role, 'move_task')) {
        throw new DelegateNotProjectMemberError();
      }
    }

    // Архивируем прежнюю активную делегацию (любой статус) перед созданием новой.
    if (active) await this.deps.delegations.setStatus(active.id, 'archived');

    const created = await this.deps.delegations.create({
      id: this.deps.idGen(),
      taskId,
      delegateUserId,
      delegatorUserId: callerUserId,
      // Мгновенное делегирование: новая делегация сразу accepted (спека §4).
      status: 'accepted',
    });

    void this.notifyDelegated(created, task, callerUserId).catch((err: unknown) => {
      console.error('[delegation:reassign] notify failed:', err);
    });

    return created;
  }

  private async notifyDelegated(
    delegation: TaskDelegation,
    task: Task,
    creatorUserId: string,
  ): Promise<void> {
    const [delegate, creator] = await Promise.all([
      this.deps.users.getById(delegation.delegateUserId),
      this.deps.users.getById(creatorUserId),
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
        actorUserId: creatorUserId,
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
