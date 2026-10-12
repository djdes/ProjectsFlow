import type { TaskChange } from '../../domain/notifications/TaskChange.js';
import { taskChangeRecipients } from '../../domain/notifications/TaskChange.js';
import { resolvePref, type NotifEventType } from '../../domain/notifications/NotificationPrefs.js';
import type { TaskChangedPayload } from '../../domain/notifications/Notification.js';
import type { Project } from '../../domain/project/Project.js';
import type { Task } from '../../domain/task/Task.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { SendAgentTelegramNotification } from '../telegram/SendAgentTelegramNotification.js';
import type { NotificationRepository } from './NotificationRepository.js';
import type { EmailSender } from './EmailSender.js';
import { escapeHtml, renderEmailLayout } from './emails/layout.js';
import { taskChangeMessage } from './taskChangeMessage.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly users: UserRepository;
  readonly notifications: NotificationRepository;
  readonly email: EmailSender;
  readonly telegram: Pick<SendAgentTelegramNotification, 'execute'>;
  readonly appUrl: string;
  readonly idGen: () => string;
};

// All channels share one recipient decision and one committed before/after snapshot.
// Transport failures are isolated: SMTP must never suppress Telegram or the site.
export class DispatchTaskChangeNotifications {
  constructor(private readonly deps: Deps) {}

  async execute(change: TaskChange): Promise<void> {
    if (change.changedFields.length === 0) return;
    const { task, previous, actorUserId } = change;
    const project = await this.deps.projects.getById(task.projectId);
    if (!project) return;
    const moved = previous && previous.projectId !== task.projectId;
    const previousProject = moved ? await this.deps.projects.getById(previous.projectId) : project;
    const approvers = await this.deps.members.listApproverUserIdsForProject(project.id);
    const previousApprovers = moved && previousProject
      ? await this.deps.members.listApproverUserIdsForProject(previousProject.id) : [];
    const actor = actorUserId ? await this.deps.users.getById(actorUserId) : null;
    const actorDisplayName = actor?.displayName ?? 'Система';
    const message = taskChangeMessage(change, project.name, previousProject?.name);
    const recipients = taskChangeRecipients({
      actorUserId, assigneeUserId: task.assignee.userId,
      previousAssigneeUserId: previous?.assignee.userId,
      approverUserIds: [...approvers, ...previousApprovers],
    });
    await Promise.all(recipients.map(async (userId) => {
      try {
        const hasAccess = await this.canReceive(userId, project, task, approvers);
        // A former assignee/manager may learn that a task left their project, but
        // must not receive the new project's name, content, assignee or private URL.
        const hadAccess = !hasAccess && previous && previousProject
          ? await this.canReceive(userId, previousProject, previous, moved ? previousApprovers : approvers)
          : false;
        if (!hasAccess && !hadAccess) return;
        const user = await this.deps.users.getById(userId);
        if (!user) return;
        const context = hasAccess ? project : previousProject!;
        const snapshot = hasAccess ? task : previous!;
        const detail = hasAccess ? message.detail : 'Задача перенесена или переназначена. Доступ к ней изменился.';
        const title = hasAccess ? message.title : 'Задача больше не в вашей работе';
        const excerpt = (snapshot.description ?? '').slice(0, 240);
        const url = hasAccess && message.action !== 'deleted'
          ? `${this.deps.appUrl.replace(/\/$/u, '')}/projects/${project.id}/tasks/${task.id}`
          : `${this.deps.appUrl.replace(/\/$/u, '')}/notifications`;
        const payload: TaskChangedPayload = {
          type: 'task_changed', taskId: task.id, projectId: context.id,
          projectName: context.name, taskExcerpt: excerpt,
          actorUserId: actorUserId ?? 'system', actorDisplayName,
          action: message.action, title, detail, taskAvailable: hasAccess && message.action !== 'deleted',
        };
        const pref: NotifEventType = message.action === 'created' ? 'task_created'
          : message.action === 'completed' || message.action === 'approved' ? 'task_done'
          : message.action === 'deleted' ? 'task_deleted'
          : change.changedFields.includes('status') ? 'status_changed' : 'task_updated';
        let emailEnabled = false;
        try {
          const prefs = await this.deps.members.getNotificationPrefs(context.id, userId);
          emailEnabled = resolvePref(prefs, pref, 'team');
        } catch (error) {
          console.warn(`[task-notifications] email preferences ${userId} failed`, error);
        }
        const tgKind = approvers.includes(userId) && userId !== task.assignee.userId
          ? 'team_task_changed' : 'task_changed';
        const text = `${title}\n${actorDisplayName} · ${context.name}\n${excerpt}\n${detail}\n${url}`;
        const channels: Array<[string, () => Promise<unknown>]> = [
          ['site', () => this.deps.notifications.create({ id: this.deps.idGen(), userId, payload })],
          ['telegram', () => this.deps.telegram.execute({
            userId, kind: tgKind, taskId: task.id,
            projectId: hasAccess ? project.id : undefined,
            text: `<b>${escapeHtml(title)}</b>\n${escapeHtml(actorDisplayName)} · ${escapeHtml(context.name)}\n\n${escapeHtml(excerpt)}\n${escapeHtml(detail)}\n\n<a href="${escapeHtml(url)}">Открыть в ProjectsFlow</a>`,
            parseMode: 'HTML',
            // Each invocation is an actual change, not a polling repeat. Do not
            // swallow a second deadline/status change within the transport's 60s window.
            skipDedupCheck: true,
            ...(!hasAccess || message.action === 'deleted' ? { replyMarkup: { inline_keyboard: [[{ text: 'Уведомления', url }]] } } : {}),
          })],
        ];
        if (user.email && emailEnabled) {
          channels.push(['email', () => this.deps.email.send(renderEmailLayout({
            to: user.email, subject: `${title} — ${context.name}`, heading: title,
            bodyHtml: `<p>${escapeHtml(actorDisplayName)} · ${escapeHtml(context.name)}</p><p>${escapeHtml(excerpt)}</p><p>${escapeHtml(detail).replace(/\n/gu, '<br>')}</p>`,
            text, ctaUrl: url, ctaLabel: 'Открыть в ProjectsFlow',
          }))]);
        }
        await Promise.all(channels.map(async ([channel, send]) => {
          try {
            const result = await send();
            if (channel === 'telegram' && result && typeof result === 'object' && 'status' in result
              && ['error', 'rate_limited', 'forbidden'].includes(String(result.status))) {
              console.warn(`[task-notifications] ${channel} ${task.id} ${userId}: ${result.status}`);
            }
          } catch (error) {
            console.warn(`[task-notifications] ${channel} ${task.id} ${userId} failed`, error);
          }
        }));
      } catch (error) {
        console.warn(`[task-notifications] recipient ${userId} failed`, error);
      }
    }));
  }

  private async canReceive(userId: string, project: Project, task: Task, approvers: readonly string[]): Promise<boolean> {
    if (await this.deps.members.isProjectHidden?.(project.id, userId)) return false;
    if (!project.isInbox) return !!(await this.deps.members.findForProject(project.id, userId));
    if (project.ownerId === userId || task.assignee.userId === userId || approvers.includes(userId)) return true;
    return task.createdBy === userId
      && (await this.deps.members.listSharedUsers(userId)).some((member) => member.id === project.ownerId);
  }
}
