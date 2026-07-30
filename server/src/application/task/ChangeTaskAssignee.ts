import type { ApprovalGuard } from './TaskApprovalService.js';
import {
  AssigneeNotProjectMemberError,
  AssigneeNotSharedMemberError,
  TaskNotFoundError,
} from '../../domain/task/errors.js';
import type { Task } from '../../domain/task/Task.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';
import type { EmailSender } from '../notifications/EmailSender.js';
import { renderTaskAssigneeEmail } from '../notifications/emails/taskAssigneeEmail.js';
import type { NotificationRepository } from '../notifications/NotificationRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import { requireTaskModifyAccess } from './taskAuthorization.js';
import type { TaskRepository } from './TaskRepository.js';

type Deps = {
  // Приёмка (db/150): задача на утверждении заморожена для всех, кроме принимающего.
  readonly approval: ApprovalGuard;
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
  readonly users: UserRepository;
  readonly notifications: NotificationRepository;
  readonly email: EmailSender;
  readonly idGen: () => string;
  readonly appUrl: string;
  readonly activityRecorder?: ActivityRecorder;
};

export class ChangeTaskAssignee {
  constructor(private readonly deps: Deps) {}

  async execute(
    projectId: string,
    taskId: string,
    actorUserId: string,
    assigneeUserId: string,
  ): Promise<Task> {
    const task = await this.deps.tasks.getById(taskId);
    if (!task || task.projectId !== projectId) throw new TaskNotFoundError(taskId);

    // Кто вправе тронуть задачу — единый гейт с остальными task-операциями
    // (правка/перенос/удаление). Для inbox это владелец, текущий ответственный ИЛИ коллега
    // по общему пространству: он эту личную задачу видит во «Входящих», значит и смена
    // ответственного ему доступна. Раньше здесь стояла своя, более узкая проверка
    // (только владелец либо текущий ответственный) — из-за неё массовое «назначить
    // ответственного» падало 404-й ровно на личных задачах коллег.
    // Для именованного проекта — обычные права: assign_task (viewer+) или task-scope
    // текущего ответственного.
    const { project } = await requireTaskModifyAccess(
      this.deps,
      projectId,
      taskId,
      actorUserId,
      'assign_task',
    );

    if (project.isInbox) {
      // Ответственным личной задачи может стать владелец инбокса либо его коллега по
      // общему пространству (тот же круг, что видит эту доску).
      if (assigneeUserId !== project.ownerId) {
        const shared = await this.deps.members.listSharedUsers(project.ownerId);
        if (!shared.some((u) => u.id === assigneeUserId)) {
          throw new AssigneeNotSharedMemberError();
        }
      }
    } else {
      // Ответственным может стать любой участник проекта, включая viewer.
      const targetMembership = await this.deps.members.findForProject(projectId, assigneeUserId);
      if (!targetMembership) throw new AssigneeNotProjectMemberError();
    }

    if (task.assignee.userId === assigneeUserId) return task;
    let updated = await this.deps.tasks.update(taskId, { assigneeUserId }, actorUserId);
    if (!updated) throw new TaskNotFoundError(taskId);

    // Правило «я ответственный ⇒ задача в моих личных»: личная задача всегда лежит во
    // входящих СВОЕГО ответственного. Назначили коллегу — запись переезжает в его inbox,
    // иначе она осталась бы чужой записью в его колонках (карточка «Личные · <чужое имя>»
    // в собственных «Черновиках» читается как ошибка). Прежний владелец не теряет её из
    // виду: личные доски коллег видны во вкладке «Для всех».
    // Задачи именованных проектов не трогаем — они живут на доске своего проекта.
    if (project.isInbox && assigneeUserId !== project.ownerId) {
      const targetInbox = await this.deps.projects.findInboxByOwner(assigneeUserId);
      // Нет inbox'а (юзер ещё ни разу его не открывал) — оставляем запись на месте:
      // назначение важнее, а создавать чужой проект здесь мы не вправе.
      if (targetInbox && targetInbox.id !== project.id) {
        const moved = await this.deps.tasks.moveToProject(
          taskId,
          targetInbox.id,
          assigneeUserId,
          actorUserId,
        );
        if (moved) updated = moved;
      }
    }

    void this.deps.activityRecorder?.record({
      projectId,
      actorUserId,
      kind: 'task_updated',
      payload: {
        taskId,
        taskExcerpt: (task.description ?? '').slice(0, 120),
        changes: [
          {
            field: 'assignee',
            old: task.assignee.displayName,
            new: updated.assignee.displayName,
          },
        ],
      },
    });

    if (assigneeUserId !== actorUserId) {
      void this.notify(updated, actorUserId, project.name, project.isInbox).catch(
        (err: unknown) => console.error('[task:assignee] notify failed:', err),
      );
    }
    return updated;
  }

  private async notify(
    task: Task,
    actorUserId: string,
    projectName: string,
    isInbox: boolean,
  ): Promise<void> {
    const [assignee, actor] = await Promise.all([
      this.deps.users.getById(task.assignee.userId),
      this.deps.users.getById(actorUserId),
    ]);
    if (!assignee) return;
    const actorDisplayName = actor?.displayName ?? 'Кто-то';
    const taskExcerpt = (task.description ?? '').slice(0, 120);
    await this.deps.notifications.create({
      id: this.deps.idGen(),
      userId: assignee.id,
      payload: {
        type: 'task_assignee_changed',
        taskId: task.id,
        projectId: task.projectId,
        projectName,
        isInbox,
        taskExcerpt,
        actorUserId,
        actorDisplayName,
      },
    });
    const base = this.deps.appUrl.replace(/\/$/u, '');
    const taskUrl = isInbox ? `${base}/inbox` : `${base}/projects/${task.projectId}`;
    await this.deps.email.send(
      renderTaskAssigneeEmail({
        to: assignee.email,
        actorDisplayName,
        taskExcerpt,
        taskUrl,
      }),
    );
  }
}
