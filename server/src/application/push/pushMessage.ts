import type { Notification, NotificationPayload } from '../../domain/notifications/Notification.js';
import type { PushMessage } from '../../domain/push/PushSubscription.js';
import { taskExcerpt } from '../../domain/task/taskExcerpt.js';

// A system notification shows a one-two line title and a few lines of text; the phone cuts
// longer text anyway, and a push payload is limited to ~4 KB.
const TITLE_MAX = 120;
const BODY_MAX = 360;

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// Text of a description or comment without editor HTML and markdown markup.
function plain(text: string | null | undefined): string {
  return taskExcerpt(text ?? '', 4000)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]{0,3}(?:#{1,6}|[-*+]|\d+[.)]|>)[ \t]+/gm, '')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function firstLine(text: string | null | undefined): string {
  return plain(text).split('\n').map((line) => line.trim()).find(Boolean) ?? '';
}

function oneLine(text: string | null | undefined): string {
  return plain(text).replace(/\s*\n+\s*/g, ' ');
}

function lines(...parts: ReadonlyArray<string | null | undefined | false>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.trim().length > 0).join('\n');
}

function quoted(text: string): string | null {
  return text ? `«${text}»` : null;
}

function byline(actor: string | null | undefined, place: string | null | undefined): string {
  return [actor, place].filter((part) => part && part.trim()).join(' · ');
}

// The task page path, the same one the client builds (notificationTaskTarget).
export function taskPath(projectId: string, taskId: string, commentId?: string): string {
  return `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}` +
    (commentId ? `#comment-${encodeURIComponent(commentId)}` : '');
}

function content(payload: NotificationPayload): { title: string; body: string; url: string } {
  switch (payload.type) {
    case 'task_changed':
      return {
        title: payload.title,
        body: lines(
          quoted(firstLine(payload.taskExcerpt)),
          oneLine(payload.detail),
          byline(payload.actorDisplayName, payload.projectName),
        ),
        url: payload.taskAvailable ? taskPath(payload.projectId, payload.taskId, payload.commentId) : '/',
      };
    case 'comment_mention':
      return {
        title: 'Вас упомянули в комментарии',
        body: lines(
          `${payload.actorDisplayName}: ${oneLine(payload.commentExcerpt)}`,
          byline(quoted(firstLine(payload.taskExcerpt)), payload.projectName),
        ),
        url: taskPath(payload.projectId, payload.taskId, payload.commentId),
      };
    case 'task_assignee_changed':
      return {
        title: 'Вам назначена задача',
        body: lines(quoted(firstLine(payload.taskExcerpt)), byline(payload.actorDisplayName, payload.projectName)),
        url: taskPath(payload.projectId, payload.taskId),
      };
    case 'task_approval_requested':
      return {
        title: 'Задача ждёт утверждения',
        body: lines(quoted(firstLine(payload.taskExcerpt)), byline(payload.actorDisplayName, payload.projectName)),
        url: taskPath(payload.projectId, payload.taskId),
      };
    case 'task_assigned_to_project':
      return {
        title: 'Задача перенесена в проект',
        body: lines(quoted(firstLine(payload.taskExcerpt)), byline(payload.actorDisplayName, payload.projectName)),
        url: taskPath(payload.projectId, payload.taskId),
      };
    case 'task_delegation':
      return {
        title: 'Вам назначена задача',
        body: lines(quoted(firstLine(payload.taskExcerpt)), payload.actorDisplayName),
        url: '/',
      };
    case 'task_delegation_resolved':
      return {
        title: payload.resolution === 'accepted' ? 'Задачу приняли' : 'От задачи отказались',
        body: lines(quoted(firstLine(payload.taskExcerpt)), payload.actorDisplayName),
        url: '/',
      };
    case 'close_proposal':
      return {
        title: 'Закрыть задачу по коммиту?',
        body: lines(
          quoted(firstLine(payload.taskExcerpt)),
          `Коммит ${payload.commitSha.slice(0, 7)}${payload.reason ? ` — ${oneLine(payload.reason)}` : ''}`,
          payload.projectName,
        ),
        url: taskPath(payload.projectId, payload.taskId),
      };
    case 'project_invite':
      return {
        title: 'Приглашение в проект',
        body: `${payload.actorDisplayName} приглашает вас в «${payload.projectName}»`,
        url: `/invite/${encodeURIComponent(payload.token)}`,
      };
    case 'workspace_invite':
      return {
        title: 'Приглашение в пространство',
        body: `${payload.actorDisplayName} приглашает вас в «${payload.workspaceName}»`,
        url: `/invite/${encodeURIComponent(payload.token)}`,
      };
    case 'join_request':
      return {
        title: 'Запрос доступа к проекту',
        body: `${payload.requesterDisplayName} просит доступ к «${payload.projectName}»`,
        url: `/projects/${encodeURIComponent(payload.projectId)}`,
      };
    case 'server_alert':
      return {
        title: payload.alertStatus === 'resolved'
          ? `Сервер «${payload.serverName}» снова в норме`
          : `${payload.severity === 'critical' ? 'Авария' : 'Проблема'} на сервере «${payload.serverName}»`,
        body: lines(oneLine(payload.message), payload.projectName),
        url: `/projects/${encodeURIComponent(payload.projectId)}/monitoring`,
      };
    case 'daily_digest':
      return {
        title: `Сводка по проекту «${payload.projectName}»`,
        body: `Задач в сводке: ${payload.taskCount}`,
        url: `/projects/${encodeURIComponent(payload.projectId)}`,
      };
    case 'chat_mention':
      return {
        title: 'Вас упомянули в чате',
        body: lines(`${payload.actorDisplayName}: ${oneLine(payload.messageExcerpt)}`, payload.workspaceName),
        url: '/',
      };
    case 'support_ticket':
      return {
        title: 'Новое обращение в поддержку',
        body: `${payload.submitterDisplayName ?? 'Без входа'}: ${oneLine(payload.messageExcerpt)}`,
        url: '/admin?tab=support',
      };
  }
}

// The device push for a bell notification: the same event, a short text and the link a tap opens.
export function pushMessageFor(notification: Notification): PushMessage {
  const { title, body, url } = content(notification.payload);
  return {
    title: cut(title.trim() || 'ProjectsFlow', TITLE_MAX),
    body: cut(body, BODY_MAX),
    url,
    workspaceId: notification.workspaceId ?? null,
  };
}
