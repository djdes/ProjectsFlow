import type { ApprovalGuard } from './TaskApprovalService.js';
import {
  AssigneeNotProjectMemberError,
  AssigneeNotSharedMemberError,
  TaskNotFoundError,
} from '../../domain/task/errors.js';
import type { Task } from '../../domain/task/Task.js';
import type { ActivityRecorder } from '../activity/ActivityRecorder.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireTaskModifyAccess } from './taskAuthorization.js';
import type { TaskRepository } from './TaskRepository.js';

type Deps = {
  // Приёмка (db/150): задача на утверждении заморожена для всех, кроме принимающего.
  readonly approval: ApprovalGuard;
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly tasks: TaskRepository;
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
    // One committed mutation (including the inbox move), hence one notification.
    const targetInbox = project.isInbox && assigneeUserId !== project.ownerId
      ? await this.deps.projects.findInboxByOwner(assigneeUserId) : null;
    const updated = targetInbox && targetInbox.id !== project.id
      ? await this.deps.tasks.moveToProject(taskId, targetInbox.id, assigneeUserId, actorUserId)
      : await this.deps.tasks.update(taskId, { assigneeUserId }, actorUserId);
    if (!updated) throw new TaskNotFoundError(taskId);

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

    return updated;
  }

}
