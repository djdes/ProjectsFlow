import type { EmailSender } from './EmailSender.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import {
  resolvePref,
  type NotifEventType,
  type NotifSource,
} from '../../domain/notifications/NotificationPrefs.js';
import { renderActivityEmail, type ActivityEmailInput } from './emails/activityEmail.js';
import { renderProjectDeletedEmail } from './emails/projectDeletedEmail.js';

type Deps = {
  readonly members: ProjectMemberRepository;
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly email: EmailSender;
  readonly appUrl: string;
};

type TaskCtx = { readonly id: string; readonly description: string | null };

// Рассылает email-оповещения участникам проекта (кроме актора) по их персональным
// настройкам. Все методы best-effort: вызываются из роутов fire-and-forget, ошибки
// конкретного получателя не роняют рассылку остальным и не влияют на HTTP-ответ.
export class ProjectNotificationService {
  constructor(private readonly deps: Deps) {}

  private taskUrl(projectId: string, taskId: string): string {
    const base = this.deps.appUrl.replace(/\/$/, '');
    return `${base}/projects/${projectId}?task=${taskId}`;
  }

  private projectUrl(projectId: string): string {
    const base = this.deps.appUrl.replace(/\/$/, '');
    return `${base}/projects/${projectId}/overview`;
  }

  // Ядро: резолвит получателей и шлёт письма. buildInput получает email получателя.
  private async dispatch(
    projectId: string,
    actorUserId: string,
    type: NotifEventType,
    source: NotifSource,
    buildInput: (to: string, projectName: string, actorName: string) => ActivityEmailInput,
  ): Promise<void> {
    const [project, members] = await Promise.all([
      this.deps.projects.getById(projectId),
      this.deps.members.listByProject(projectId),
    ]);
    if (!project) return;

    const actor = members.find((m) => m.userId === actorUserId);
    const actorName = actor?.user.displayName ?? 'Участник';

    const recipients = members.filter(
      (m) => m.userId !== actorUserId && resolvePref(m.notificationPrefs, type, source),
    );
    if (recipients.length === 0) return;

    await Promise.all(
      recipients.map(async (m) => {
        try {
          const msg = renderActivityEmail(buildInput(m.user.email, project.name, actorName));
          await this.deps.email.send(msg);
        } catch (e) {
          console.warn(`[notifications] email to ${m.user.email} failed:`, e);
        }
      }),
    );
  }

  onTaskCreated(projectId: string, actorUserId: string, task: TaskCtx, source: NotifSource): Promise<void> {
    return this.dispatch(projectId, actorUserId, 'task_created', source, (to, projectName, actorName) => ({
      to,
      type: 'task_created',
      projectName,
      actorDisplayName: actorName,
      taskExcerpt: task.description ?? undefined,
      ctaUrl: this.taskUrl(projectId, task.id),
    }));
  }

  onTaskDone(projectId: string, actorUserId: string, task: TaskCtx, source: NotifSource): Promise<void> {
    return this.dispatch(projectId, actorUserId, 'task_done', source, (to, projectName, actorName) => ({
      to,
      type: 'task_done',
      projectName,
      actorDisplayName: actorName,
      taskExcerpt: task.description ?? undefined,
      ctaUrl: this.taskUrl(projectId, task.id),
    }));
  }

  async onComment(
    projectId: string,
    actorUserId: string,
    taskId: string,
    commentBody: string,
    source: NotifSource,
  ): Promise<void> {
    const task = await this.deps.tasks.getById(taskId);
    await this.dispatch(projectId, actorUserId, 'comment_created', source, (to, projectName, actorName) => ({
      to,
      type: 'comment_created',
      projectName,
      actorDisplayName: actorName,
      taskExcerpt: task?.description ?? '',
      commentExcerpt: commentBody,
      ctaUrl: this.taskUrl(projectId, taskId),
      ctaLabel: 'Открыть обсуждение',
    }));
  }

  async onStatusChanged(
    projectId: string,
    actorUserId: string,
    task: TaskCtx,
    oldStatus: string,
    newStatus: string,
    source: NotifSource,
  ): Promise<void> {
    await this.dispatch(projectId, actorUserId, 'status_changed', source, (to, projectName, actorName) => ({
      to,
      type: 'status_changed',
      projectName,
      actorDisplayName: actorName,
      taskExcerpt: task.description ?? undefined,
      detail: `${oldStatus} → ${newStatus}`,
      ctaUrl: this.taskUrl(projectId, task.id),
    }));
  }

  onMemberChanged(
    projectId: string,
    actorUserId: string,
    detail: string,
    source: NotifSource,
  ): Promise<void> {
    return this.dispatch(projectId, actorUserId, 'member_changed', source, (to, projectName, actorName) => ({
      to,
      type: 'member_changed',
      projectName,
      actorDisplayName: actorName,
      detail,
      ctaUrl: this.projectUrl(projectId),
      ctaLabel: 'Открыть проект',
    }));
  }

  async onCommitLinked(
    projectId: string,
    actorUserId: string,
    taskId: string,
    source: NotifSource,
  ): Promise<void> {
    const task = await this.deps.tasks.getById(taskId);
    await this.dispatch(projectId, actorUserId, 'commit_linked', source, (to, projectName, actorName) => ({
      to,
      type: 'commit_linked',
      projectName,
      actorDisplayName: actorName,
      taskExcerpt: task?.description ?? '',
      ctaUrl: this.taskUrl(projectId, taskId),
    }));
  }

  onKbUpdated(
    projectId: string,
    actorUserId: string,
    detail: string,
    source: NotifSource,
  ): Promise<void> {
    return this.dispatch(projectId, actorUserId, 'kb_updated', source, (to, projectName, actorName) => ({
      to,
      type: 'kb_updated',
      projectName,
      actorDisplayName: actorName,
      detail,
      ctaUrl: this.projectUrl(projectId),
      ctaLabel: 'Открыть проект',
    }));
  }

  // Уведомление об удалении проекта. Особый случай: project'а в БД уже нет, поэтому
  // принимаем snapshot напрямую и НЕ дёргаем dispatch (он начал бы с lookup'а
  // projects.getById и тихо вышел бы из-за отсутствия). Best-effort, как и другие
  // методы — каждое письмо в своём try/catch, ошибки одного получателя не валят рассылку.
  async onProjectDeleted(input: {
    projectName: string;
    actorUserId: string;
    actorDisplayName: string;
    recipients: ReadonlyArray<{ userId: string; email: string }>;
  }): Promise<void> {
    const targets = input.recipients.filter((r) => r.userId !== input.actorUserId);
    if (targets.length === 0) return;
    await Promise.all(
      targets.map(async (r) => {
        try {
          const msg = renderProjectDeletedEmail({
            to: r.email,
            projectName: input.projectName,
            actorDisplayName: input.actorDisplayName,
            appUrl: this.deps.appUrl.replace(/\/$/, ''),
          });
          await this.deps.email.send(msg);
        } catch (e) {
          console.warn(`[notifications] project-deleted email to ${r.email} failed:`, e);
        }
      }),
    );
  }
}
