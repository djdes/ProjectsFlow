import {
  AlreadyDelegatedError,
  DelegateNotInSharedMembersError,
  DelegateNotProjectMemberError,
  NotCreatorError,
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

// Делегировать уже созданную inbox-задачу (post-create flow). Каркас тот же что
// у CreateTask.delegateOrThrow, но stand-alone: используется для UI «делегировать»
// на существующей карточке (TaskDrawer edit-mode).
export class DelegateExistingTask {
  constructor(private readonly deps: Deps) {}

  async execute(
    taskId: string,
    delegateUserId: string,
    creatorUserId: string,
  ): Promise<TaskDelegation> {
    // Самоделегирование РАЗРЕШЕНО: «назначить себя ответственным» (drag-перенос
    // инбокс-задачи в проект). isSelf влияет только на валидацию (себя нет в
    // shared-members) и на уведомления (себе не шлём) — статус у ВСЕХ делегирований
    // одинаковый: accepted сразу при создании.
    const isSelf = delegateUserId === creatorUserId;

    const task = await this.deps.tasks.getById(taskId);
    if (!task) throw new TaskNotFoundError(taskId);

    const project = await this.deps.projects.getById(task.projectId);
    if (!project) throw new TaskNotFoundError(taskId);

    if (project.isInbox) {
      // Inbox: делегировать может только владелец инбокса, делегату — любому из общих
      // проектов (он будет видеть задачу как accepted-delegate, не будучи членом инбокса).
      // Себя в shared-members нет (сервер исключает) — для isSelf проверка пропускается.
      if (project.ownerId !== creatorUserId) throw new NotCreatorError();
      if (!isSelf) {
        const shared = await this.deps.members.listSharedUsers(creatorUserId);
        if (!shared.find((u) => u.id === delegateUserId)) {
          throw new DelegateNotInSharedMembersError();
        }
      }
    } else {
      // Именованный проект: делегатор — с правом delegate_task (editor+); делегат —
      // участник-редактор этого проекта, иначе примет, но получит 403 на move/выполнение
      // (requireTaskModifyAccess non-inbox = requireProjectAccess('move_task')).
      // Для isSelf делегат == делегатор — его право уже проверено requireProjectAccess.
      await requireProjectAccess(this.deps, project.id, creatorUserId, 'delegate_task');
      if (!isSelf) {
        const membership = await this.deps.members.findForProject(project.id, delegateUserId);
        if (!membership || !can(membership.role, 'move_task')) {
          throw new DelegateNotProjectMemberError();
        }
      }
    }

    const active = await this.deps.delegations.findActiveForTask(taskId);
    if (active) throw new AlreadyDelegatedError();

    const created = await this.deps.delegations.create({
      id: this.deps.idGen(),
      taskId,
      delegateUserId,
      delegatorUserId: creatorUserId,
      // Делегирование без принятия/отказа: всегда сразу accepted (спека
      // 2026-07-13-unified-workspace §4). isSelf-особая ветка стала общим случаем.
      status: 'accepted',
    });

    if (!isSelf) {
      void this.notifyDelegated(created, task, creatorUserId).catch((err: unknown) => {
        console.error('[delegation:existing] notify failed:', err);
      });
    }

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
