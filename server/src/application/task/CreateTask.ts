import {
  AssigneeNotProjectMemberError,
  AssigneeNotSharedMemberError,
  TaskDescriptionEmptyError,
} from '../../domain/task/errors.js';
import type { RalphMode, Task, TaskPriority, TaskStatus } from '../../domain/task/Task.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { TaskRepository } from './TaskRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { NotificationRepository } from '../notifications/NotificationRepository.js';
import type { EmailSender } from '../notifications/EmailSender.js';
import { renderTaskAssigneeEmail } from '../notifications/emails/taskAssigneeEmail.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';
import type { Project } from '../../domain/project/Project.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly users: UserRepository;
  readonly notifications: NotificationRepository;
  readonly email: EmailSender;
  readonly idGen: () => string;
  // Base URL для ссылки на задачу в уведомлении.
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
  // Иконка задачи: эмодзи / lucide:Name[:color] / data-URL. null/undefined = без иконки. См. db/093.
  readonly icon?: string | null;
  // Обложка задачи: CSS-градиент/пресет или data-URL. null/undefined = без обложки. См. db/094.
  readonly cover?: string | null;
  // Вертикальное положение фокуса обложки (0..100). undefined = дефолт 50. См. db/094.
  readonly coverPosition?: number;
  // По умолчанию новая карточка добавляется в TODO наверх столбца.
  readonly status: TaskStatus;
  // Позиция: поставить сразу ПОСЛЕ этой задачи (для цепочки inline-создания). undefined = наверх колонки.
  readonly afterTaskId?: string | null;
  // Режим работы Ralph по задаче. Если не указан — БД проставит DEFAULT 'normal'.
  readonly ralphMode?: RalphMode;
  // Единственный ответственный. Если не указан — actor (для attributeToOwner automation
  // это владелец проекта, чтобы системный админ не становился ответственным).
  readonly assigneeUserId?: string | null;
  // Срок выполнения. ISO 'YYYY-MM-DD'. null/undefined — без deadline.
  readonly deadline?: string | null;
  // Дата начала (диапазон startDate → deadline). null/undefined — событие одного дня.
  readonly startDate?: string | null;
  // Подзадача: id родителя (валидируется: родитель существует и в том же проекте).
  readonly parentTaskId?: string | null;
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
    const assigneeUserId = input.assigneeUserId ?? createdBy;
    await this.validateAssignee(project, assigneeUserId);

    // Кладём в самый верх колонки: position = min - STEP. Это даёт «свежее наверху»
    // в обоих UI-режимах (kanban и list — оба сортируют по position по возрастанию).
    // Исключение: если задан afterTaskId — ставим сразу ПОСЛЕ якорной задачи (в той же
    // колонке проекта+статуса), чтобы сохранить порядок при цепочке inline-создания.
    let position: number;
    const anchor = input.afterTaskId ? await this.deps.tasks.getById(input.afterTaskId) : null;
    if (
      anchor &&
      anchor.projectId === input.projectId &&
      anchor.status === input.status
    ) {
      position = anchor.position + 1;
    } else {
      const bounds = await this.deps.tasks.getPositionBounds(input.projectId, input.status);
      position = bounds ? bounds.min - POSITION_STEP : POSITION_STEP;
    }

    // Подзадача: родитель должен существовать и быть в том же проекте (db/107).
    let parentTaskId: string | null = null;
    if (input.parentTaskId) {
      const parent = await this.deps.tasks.getById(input.parentTaskId);
      if (parent && parent.projectId === input.projectId) parentTaskId = parent.id;
    }

    const task = await this.deps.tasks.create({
      id: this.deps.idGen(),
      projectId: input.projectId,
      createdBy,
      assigneeUserId,
      description,
      icon: input.icon ?? null,
      cover: input.cover ?? null,
      coverPosition: input.coverPosition ?? 50,
      status: input.status,
      position,
      ralphMode: input.ralphMode,
      deadline: input.deadline ?? null,
      startDate: input.startDate ?? null,
      parentTaskId,
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

    if (assigneeUserId !== input.ownerUserId) {
      void this.notifyAssigned(task, input.ownerUserId, project).catch((err: unknown) => {
        console.error('[task:assignee:create] notify failed:', err);
      });
    }
    return task;
  }

  private async validateAssignee(project: Project, assigneeUserId: string): Promise<void> {
    if (project.isInbox) {
      if (assigneeUserId === project.ownerId) return;
      const shared = await this.deps.members.listSharedUsers(project.ownerId);
      if (!shared.some((u) => u.id === assigneeUserId)) {
        throw new AssigneeNotSharedMemberError();
      }
      return;
    }
    // Создавать задачу по-прежнему может editor+, но ответственным может стать любой
    // участник проекта, включая viewer.
    const membership = await this.deps.members.findForProject(project.id, assigneeUserId);
    if (!membership) throw new AssigneeNotProjectMemberError();
  }

  private async notifyAssigned(
    task: Task,
    actorUserId: string,
    project: Project,
  ): Promise<void> {
    const [assignee, actor] = await Promise.all([
      this.deps.users.getById(task.assignee.userId),
      this.deps.users.getById(actorUserId),
    ]);
    if (!assignee) return;

    const taskExcerpt = (task.description ?? '').slice(0, 120);
    const actorDisplayName = actor?.displayName ?? 'Кто-то';
    const base = this.deps.appUrl.replace(/\/$/u, '');
    const taskUrl = project.isInbox ? `${base}/inbox` : `${base}/projects/${project.id}`;

    await this.deps.notifications.create({
      id: this.deps.idGen(),
      userId: assignee.id,
      payload: {
        type: 'task_assignee_changed',
        taskId: task.id,
        projectId: project.id,
        projectName: project.name,
        isInbox: project.isInbox,
        taskExcerpt,
        actorUserId,
        actorDisplayName,
      },
    });

    const message = renderTaskAssigneeEmail({
      to: assignee.email,
      actorDisplayName,
      taskExcerpt,
      taskUrl,
    });
    await this.deps.email.send(message);
  }
}
