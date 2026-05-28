import {
  AlreadyDelegatedError,
  DelegateNotInSharedMembersError,
  DelegationOnNonInboxError,
  NotCreatorError,
  SelfDelegationError,
  TaskNotFoundError,
} from '../../domain/task/errors.js';
import type { Task } from '../../domain/task/Task.js';
import type { TaskDelegation } from '../../domain/task/TaskDelegation.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
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
    if (delegateUserId === creatorUserId) throw new SelfDelegationError();

    const task = await this.deps.tasks.getById(taskId);
    if (!task) throw new TaskNotFoundError(taskId);

    const project = await this.deps.projects.getById(task.projectId);
    if (!project?.isInbox) throw new DelegationOnNonInboxError();
    if (project.ownerId !== creatorUserId) throw new NotCreatorError();

    const shared = await this.deps.members.listSharedUsers(creatorUserId);
    if (!shared.find((u) => u.id === delegateUserId)) {
      throw new DelegateNotInSharedMembersError();
    }

    const active = await this.deps.delegations.findActiveForTask(taskId);
    if (active) throw new AlreadyDelegatedError();

    const created = await this.deps.delegations.create({
      id: this.deps.idGen(),
      taskId,
      delegateUserId,
    });

    void this.notifyDelegated(created, task, creatorUserId).catch((err: unknown) => {
      console.error('[delegation:existing] notify failed:', err);
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
