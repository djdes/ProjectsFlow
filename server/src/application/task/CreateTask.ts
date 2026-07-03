import {
  AlreadyDelegatedError,
  DelegateNotInSharedMembersError,
  DelegateNotProjectMemberError,
  SelfDelegationError,
  TaskDescriptionEmptyError,
} from '../../domain/task/errors.js';
import { can } from '../../domain/project/permissions.js';
import type { RalphMode, Task, TaskPriority, TaskStatus } from '../../domain/task/Task.js';
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
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly delegations: TaskDelegationRepository;
  readonly users: UserRepository;
  readonly notifications: NotificationRepository;
  readonly email: EmailSender;
  readonly idGen: () => string;
  // Base URL для accept/decline ссылки в письме. /inbox#delegation=<id>.
  readonly appUrl: string;
  // Лента действий (best-effort). Опционально — старые caller'ы/тесты не ломаются.
  readonly activityRecorder?: ActivityRecorder;
  // Первый снимок версии задачи (для окна версий + restore).
  readonly versions?: import('./TaskVersionRecorder.js').TaskVersionRecorder;
};

export type CreateTaskCommand = {
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly description: string;
  // По умолчанию новая карточка добавляется в TODO наверх столбца.
  readonly status: TaskStatus;
  // Режим работы Ralph по задаче. Если не указан — БД проставит DEFAULT 'normal'.
  readonly ralphMode?: RalphMode;
  // Опциональное one-to-one делегирование. Допустимо только для inbox-задач
  // (project.isInbox=true) и только если delegateUserId в shared-members списке
  // creator'а. null/undefined — обычная задача.
  readonly delegateUserId?: string | null;
  // Срок выполнения. ISO 'YYYY-MM-DD'. null/undefined — без deadline.
  readonly deadline?: string | null;
  // Приоритет 1..4. null/undefined — без приоритета.
  readonly priority?: TaskPriority | null;
  // true — атрибутировать создателя (created_by) НЕ на actor'а (ownerUserId), а на владельца
  // проекта. Для автоматизации (агент создаёт задачу от имени диспетчера-админа): расход
  // воркера по такой задаче должен списываться на владельца проекта, а не на безлимитного
  // админа — иначе автоматизация = бесплатный расход подписки.
  readonly attributeToOwner?: boolean;
};

const POSITION_STEP = 1024;

export class CreateTask {
  constructor(private readonly deps: Deps) {}

  async execute(input: CreateTaskCommand): Promise<Task> {
    const description = input.description.trim();
    if (description.length === 0) throw new TaskDescriptionEmptyError();

    const { project } = await requireProjectAccess(
      this.deps,
      input.projectId,
      input.ownerUserId,
      'create_task',
    );
    // Создатель для метеринга: обычно actor; для автоматизации — владелец проекта.
    const createdBy = input.attributeToOwner ? project.ownerId : input.ownerUserId;

    // Кладём в самый верх колонки: position = min - STEP. Это даёт «свежее наверху»
    // в обоих UI-режимах (kanban и list — оба сортируют по position по возрастанию).
    const bounds = await this.deps.tasks.getPositionBounds(input.projectId, input.status);
    const position = bounds ? bounds.min - POSITION_STEP : POSITION_STEP;

    const task = await this.deps.tasks.create({
      id: this.deps.idGen(),
      projectId: input.projectId,
      createdBy,
      description,
      status: input.status,
      position,
      ralphMode: input.ralphMode,
      deadline: input.deadline ?? null,
      priority: input.priority ?? null,
    });

    // Лента действий (best-effort, не блокирует создание).
    void this.deps.activityRecorder?.record({
      projectId: input.projectId,
      actorUserId: input.ownerUserId,
      kind: 'task_created',
      payload: { taskId: task.id, taskExcerpt: description.slice(0, 120) },
    });
    // Первый снимок версии (best-effort).
    void this.deps.versions?.record(task, input.ownerUserId);

    let delegation: TaskDelegation | null = null;
    if (input.delegateUserId) {
      delegation = await this.delegateOrThrow(
        task.id,
        description,
        input.delegateUserId,
        input.ownerUserId,
        input.projectId,
      );
    }

    return { ...task, delegation };
  }

  private async delegateOrThrow(
    taskId: string,
    description: string,
    delegateUserId: string,
    creatorUserId: string,
    projectId: string,
  ): Promise<TaskDelegation> {
    if (delegateUserId === creatorUserId) throw new SelfDelegationError();

    const project = await this.deps.projects.getById(projectId);
    if (project && !project.isInbox) {
      // Именованный проект: делегатор — с правом delegate_task (editor+); делегат —
      // участник-редактор этого проекта.
      await requireProjectAccess(this.deps, project.id, creatorUserId, 'delegate_task');
      const membership = await this.deps.members.findForProject(project.id, delegateUserId);
      if (!membership || !can(membership.role, 'move_task')) {
        throw new DelegateNotProjectMemberError();
      }
    } else {
      // Inbox (или защитный фолбэк): делегат должен быть в shared-members caller'а.
      const shared = await this.deps.members.listSharedUsers(creatorUserId);
      if (!shared.find((u) => u.id === delegateUserId)) {
        throw new DelegateNotInSharedMembersError();
      }
    }

    // Гонка: ничтожно мала (новая задача только что создана), но check на всякий.
    const active = await this.deps.delegations.findActiveForTask(taskId);
    if (active) throw new AlreadyDelegatedError();

    const created = await this.deps.delegations.create({
      id: this.deps.idGen(),
      taskId,
      delegateUserId,
      delegatorUserId: creatorUserId,
    });

    // Best-effort notification + email. Не блокируют успех create.
    void this.notifyDelegated(created, description, creatorUserId).catch((err: unknown) => {
      console.error('[delegation] notify failed:', err);
    });

    return created;
  }

  private async notifyDelegated(
    delegation: TaskDelegation,
    taskDescription: string,
    creatorUserId: string,
  ): Promise<void> {
    const [delegate, creator] = await Promise.all([
      this.deps.users.getById(delegation.delegateUserId),
      this.deps.users.getById(creatorUserId),
    ]);
    if (!delegate) return;

    const taskExcerpt = taskDescription.slice(0, 120);
    const actorDisplayName = creator?.displayName ?? 'Кто-то';
    const inboxUrl = `${this.deps.appUrl.replace(/\/$/, '')}/inbox#delegation=${delegation.id}`;

    // 1) In-app notification — публикуется через SSE-хаб (PublishingNotificationRepository).
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

    // 2) Email.
    const message = renderDelegationEmail({
      to: delegate.email,
      actorDisplayName,
      taskExcerpt,
      inboxUrl,
    });
    await this.deps.email.send(message);
  }
}
