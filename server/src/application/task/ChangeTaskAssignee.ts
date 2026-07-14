import { ProjectNotFoundError } from '../../domain/project/errors.js';
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
import { requireProjectAccess } from '../project/projectAccess.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { TaskRepository } from './TaskRepository.js';

type Deps = {
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
    const project = await this.deps.projects.getById(projectId);
    if (!project) throw new TaskNotFoundError(taskId);

    if (project.isInbox) {
      // Личную задачу видят и переназначают владелец inbox либо её текущий ответственный.
      if (project.ownerId !== actorUserId && task.assignee.userId !== actorUserId) {
        throw new ProjectNotFoundError();
      }
      if (assigneeUserId !== project.ownerId) {
        const shared = await this.deps.members.listSharedUsers(project.ownerId);
        if (!shared.some((u) => u.id === assigneeUserId)) {
          throw new AssigneeNotSharedMemberError();
        }
      }
    } else {
      // Менять ответственного может любой участник проекта, включая viewer.
      await requireProjectAccess(this.deps, projectId, actorUserId, 'assign_task');
      const targetMembership = await this.deps.members.findForProject(projectId, assigneeUserId);
      if (!targetMembership) throw new AssigneeNotProjectMemberError();
    }

    if (task.assignee.userId === assigneeUserId) return task;
    const updated = await this.deps.tasks.update(taskId, { assigneeUserId }, actorUserId);
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
