import {
  NotCreatorError,
  TargetProjectIsInboxError,
  TargetProjectNotFoundError,
  TaskNotFoundError,
} from '../../domain/task/errors.js';
import type { Task } from '../../domain/task/Task.js';
import type { TaskRepository } from './TaskRepository.js';
import type { TaskDelegationRepository } from './TaskDelegationRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { NotificationRepository } from '../notifications/NotificationRepository.js';
import type { EmailSender } from '../notifications/EmailSender.js';
import { renderTaskAssignedToProjectEmail } from '../notifications/emails/taskAssignedToProjectEmail.js';

type Deps = {
  readonly tasks: TaskRepository;
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly delegations: TaskDelegationRepository;
  readonly users: UserRepository;
  readonly notifications: NotificationRepository;
  readonly email: EmailSender;
  readonly idGen: () => string;
  readonly appUrl: string;
};

// Перенос задачи в другой проект (бывший AssignInboxTaskToProject, обобщён):
// - из инбокса — только creator (owner inbox-проекта), как раньше;
// - из именованного проекта — участник с правом move_task (editor+);
// - целевой проект: именованный — caller должен иметь в нём create_task; СВОЙ инбокс —
//   разрешён (drag пилюли делегирования на нижнюю доску «Входящих» забирает задачу проекта
//   к себе в личные); чужой инбокс — по-прежнему нельзя.
// Активная делегация (если есть) → archived (делегат может не быть участником целевого
// проекта). Делегату — email + in-app notification (кроме делегат == caller: забрал свою
// же задачу — сами себя не уведомляем).
export class MoveTaskToProject {
  constructor(private readonly deps: Deps) {}

  async execute(
    taskId: string,
    targetProjectId: string,
    userId: string,
  ): Promise<Task> {
    const task = await this.deps.tasks.getById(taskId);
    if (!task) throw new TaskNotFoundError(taskId);

    const sourceProject = await this.deps.projects.getById(task.projectId);
    if (sourceProject?.isInbox) {
      // Инбокс: членств там нет — гейт по владельцу.
      if (sourceProject.ownerId !== userId) throw new NotCreatorError();
    } else {
      // Именованный проект: перенос = убрать задачу с доски → право move_task.
      await requireProjectAccess(this.deps, task.projectId, userId, 'move_task');
    }

    // Перенос в тот же проект — no-op (UI-селектор может прислать текущий проект).
    // СТРОГО после гейта источника: иначе ответ с телом задачи был бы IDOR-оракулом
    // (любой залогиненный получал бы чужую задачу, прислав target = её же проект).
    if (task.projectId === targetProjectId) return task;

    const targetProject = await this.deps.projects.getById(targetProjectId);
    if (!targetProject) throw new TargetProjectNotFoundError(targetProjectId);
    if (targetProject.isInbox) {
      // В инбоксе членств нет — гейт по владельцу: перенос разрешён только в СВОЙ инбокс.
      if (targetProject.ownerId !== userId) throw new TargetProjectIsInboxError();
    } else {
      // Caller должен иметь доступ к целевому проекту (member).
      await requireProjectAccess(this.deps, targetProjectId, userId, 'create_task');
    }

    // Атомарно: переезд задачи + archive активной делегации (если была).
    const active = await this.deps.delegations.findActiveForTask(taskId);
    const moved = await this.deps.tasks.moveToProject(taskId, targetProjectId);
    if (!moved) throw new TaskNotFoundError(taskId);

    let delegateUserId: string | null = null;
    if (active) {
      delegateUserId = active.delegateUserId;
      await this.deps.delegations.setStatus(active.id, 'archived');
    }

    if (delegateUserId && delegateUserId !== userId) {
      void this.notifyDelegate(
        moved,
        delegateUserId,
        targetProject.id,
        targetProject.name,
        userId,
      ).catch((err: unknown) => {
        console.error('[delegation:assign-to-project] notify failed:', err);
      });
    }

    return moved;
  }

  private async notifyDelegate(
    task: Task,
    delegateUserId: string,
    projectId: string,
    projectName: string,
    creatorUserId: string,
  ): Promise<void> {
    const [delegate, creator] = await Promise.all([
      this.deps.users.getById(delegateUserId),
      this.deps.users.getById(creatorUserId),
    ]);
    if (!delegate) return;

    const taskExcerpt = (task.description ?? '').slice(0, 120);
    const actorDisplayName = creator?.displayName ?? 'Кто-то';
    const projectUrl = `${this.deps.appUrl.replace(/\/$/, '')}/projects/${projectId}`;

    await this.deps.notifications.create({
      id: this.deps.idGen(),
      userId: delegate.id,
      payload: {
        type: 'task_assigned_to_project',
        taskId: task.id,
        taskExcerpt,
        projectId,
        projectName,
        actorUserId: creatorUserId,
        actorDisplayName,
      },
    });

    const message = renderTaskAssignedToProjectEmail({
      to: delegate.email,
      actorDisplayName,
      taskExcerpt,
      projectName,
      projectUrl,
    });
    await this.deps.email.send(message);
  }
}
