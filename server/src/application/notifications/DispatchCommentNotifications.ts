import type { EmailSender } from './EmailSender.js';
import type { CommentNotificationLogRepository, CommentNotificationRecord } from './CommentNotificationLogRepository.js';
import type { ProjectMemberRepository, ProjectMemberWithUser } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { SendAgentTelegramNotification } from '../telegram/SendAgentTelegramNotification.js';
import type { TaskCommentActorKind } from '../../domain/task/TaskComment.js';
import type { CommentNotifyMode } from '../../domain/task/TaskComment.js';
import { resolvePref, type NotifSource } from '../../domain/notifications/NotificationPrefs.js';
import { renderActivityEmail } from './emails/activityEmail.js';
import { buildTaskUrl } from './taskUrl.js';
import { parseMentions } from '../task/parseMentions.js';

export type DispatchCommentAudience = {
  readonly mode: CommentNotifyMode;
  // Для mode==='selected' — выбранные получатели (user-id). Игнорируется иначе.
  readonly userIds?: readonly string[];
};

export type DispatchCommentInput = {
  readonly projectId: string;
  readonly actorUserId: string;
  // Источник действия: 'team' (человек) или 'mcp' (агент). Влияет на дефолт pref.
  readonly source: NotifSource;
  readonly audience: DispatchCommentAudience;
  readonly comment: {
    readonly id: string;
    readonly taskId: string;
    readonly body: string;
    readonly actorKind: TaskCommentActorKind;
    readonly agentName: string | null;
  };
};

type Deps = {
  readonly members: ProjectMemberRepository;
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly email: EmailSender;
  readonly tgSend: SendAgentTelegramNotification;
  readonly log: CommentNotificationLogRepository;
  readonly idGen: () => string;
  readonly appUrl: string;
};

function escapeTgHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tgExcerpt(text: string, limit = 100): string {
  const s = text.trim().replace(/\s+/g, ' ');
  return s.length <= limit ? s : s.slice(0, limit - 1).trimEnd() + '…';
}

// Усечение reason под VARCHAR(64).
function clipReason(s: string): string {
  return s.length <= 64 ? s : s.slice(0, 64);
}

// Оркестратор уведомлений по комментарию: единственный писатель журнала
// comment_notifications. Резолвит получателей по выбору автора (audience), всегда
// добавляет упомянутых (@mention) в email-канал, шлёт email + Telegram, записывает исход
// каждого (recipient × channel). Best-effort: исключения глотаются, журнал — фактический.
export class DispatchCommentNotifications {
  constructor(private readonly deps: Deps) {}

  async execute(input: DispatchCommentInput): Promise<void> {
    const { comment } = input;
    const [project, members, task] = await Promise.all([
      this.deps.projects.getById(input.projectId),
      this.deps.members.listByProject(input.projectId),
      this.deps.tasks.getById(comment.taskId),
    ]);
    if (!project) return;

    const projectName = project.name;
    const actorName =
      comment.actorKind === 'agent'
        ? (comment.agentName ?? 'Агент')
        : (members.find((m) => m.userId === input.actorUserId)?.user.displayName ?? 'Участник');

    const nonActor = members.filter((m) => m.userId !== input.actorUserId);

    // База адресации (для обоих каналов) по выбору автора.
    const base = this.resolveBase(nonActor, input.audience);
    const baseIds = new Set(base.map((m) => m.userId));

    // Упомянутые (@mention) — всегда получают email, даже если не в base и при pref-off.
    const mentionedIds = new Set(parseMentions(comment.body, members, input.actorUserId));

    const url = buildTaskUrl(this.deps.appUrl, input.projectId, comment.taskId, comment.id);
    const rows: CommentNotificationRecord[] = [];

    // --- Email-канал: base ∪ mentioned ---
    const emailTargets = new Map<string, ProjectMemberWithUser>();
    for (const m of base) emailTargets.set(m.userId, m);
    for (const m of nonActor) if (mentionedIds.has(m.userId)) emailTargets.set(m.userId, m);

    for (const m of emailTargets.values()) {
      const forced = mentionedIds.has(m.userId);
      if (!forced && !resolvePref(m.notificationPrefs, 'comment_created', input.source)) {
        rows.push(this.row(comment.id, m.userId, 'email', 'skipped', 'pref_off'));
        continue;
      }
      if (!m.user.email) {
        rows.push(this.row(comment.id, m.userId, 'email', 'skipped', 'no_email'));
        continue;
      }
      try {
        await this.deps.email.send(
          renderActivityEmail({
            to: m.user.email,
            type: 'comment_created',
            projectName,
            actorDisplayName: actorName,
            taskExcerpt: task?.description ?? '',
            commentExcerpt: comment.body,
            ctaUrl: url,
            ctaLabel: 'Открыть комментарий',
            mentioned: forced,
          }),
        );
        rows.push(this.row(comment.id, m.userId, 'email', 'sent', null));
      } catch (e) {
        rows.push(this.row(comment.id, m.userId, 'email', 'failed', clipReason(String(e))));
      }
    }

    // --- Telegram-канал: только base (mention в TG — отдельный механизм, вне scope) ---
    const tgText =
      `💬 Новый комментарий в «${escapeTgHtml(projectName)}»:\n` +
      `<i>${escapeTgHtml(tgExcerpt(comment.body))}</i>\n\n` +
      `<a href="${url}">Открыть комментарий</a>`;

    for (const m of base) {
      try {
        const r = await this.deps.tgSend.execute({
          userId: m.userId,
          text: tgText,
          parseMode: 'HTML',
          kind: 'comment_on_my_task',
          taskId: comment.taskId,
          // projectId → инлайн «Завершить/Комментировать» + reply-комментарий на уведомление.
          projectId: input.projectId,
        });
        rows.push(this.tgRow(comment.id, m.userId, r));
      } catch (e) {
        rows.push(this.row(comment.id, m.userId, 'telegram', 'failed', clipReason(String(e))));
      }
    }

    try {
      await this.deps.log.recordMany(rows);
    } catch (e) {
      console.warn('[DispatchCommentNotifications] log.recordMany failed:', e);
    }
  }

  private resolveBase(
    nonActor: readonly ProjectMemberWithUser[],
    audience: DispatchCommentAudience,
  ): ProjectMemberWithUser[] {
    if (audience.mode === 'none') return [];
    if (audience.mode === 'selected') {
      const want = new Set(audience.userIds ?? []);
      return nonActor.filter((m) => want.has(m.userId));
    }
    return [...nonActor];
  }

  private row(
    commentId: string,
    recipientUserId: string,
    channel: CommentNotificationRecord['channel'],
    status: CommentNotificationRecord['status'],
    reason: string | null,
  ): CommentNotificationRecord {
    return { id: this.deps.idGen(), commentId, recipientUserId, channel, status, reason };
  }

  // Маппинг результата TG-отправки в строку журнала.
  private tgRow(
    commentId: string,
    recipientUserId: string,
    r: Awaited<ReturnType<SendAgentTelegramNotification['execute']>>,
  ): CommentNotificationRecord {
    switch (r.status) {
      case 'ok':
        return this.row(commentId, recipientUserId, 'telegram', 'sent', null);
      case 'pref_off':
        return this.row(commentId, recipientUserId, 'telegram', 'skipped', 'pref_off');
      case 'dedup':
        return this.row(commentId, recipientUserId, 'telegram', 'skipped', 'dedup');
      case 'not_connected':
        return this.row(commentId, recipientUserId, 'telegram', 'skipped', 'not_linked');
      case 'not_started':
        return this.row(commentId, recipientUserId, 'telegram', 'skipped', 'not_started');
      case 'rate_limited':
        return this.row(commentId, recipientUserId, 'telegram', 'failed', 'rate_limited');
      case 'forbidden':
        return this.row(commentId, recipientUserId, 'telegram', 'failed', 'forbidden');
      case 'error':
        return this.row(commentId, recipientUserId, 'telegram', 'failed', clipReason(r.description));
    }
  }
}
