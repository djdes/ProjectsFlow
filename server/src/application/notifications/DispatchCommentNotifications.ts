import type { EmailSender } from './EmailSender.js';
import type { CommentNotificationLogRepository, CommentNotificationRecord } from './CommentNotificationLogRepository.js';
import type { ProjectMemberRepository, ProjectMemberWithUser } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { TaskCommentRepository } from '../task/TaskCommentRepository.js';
import type { SendAgentTelegramNotification } from '../telegram/SendAgentTelegramNotification.js';
import type { TaskCommentActorKind } from '../../domain/task/TaskComment.js';
import type { CommentNotifyMode } from '../../domain/task/TaskComment.js';
import { resolvePref, type NotifSource } from '../../domain/notifications/NotificationPrefs.js';
import { renderActivityEmail } from './emails/activityEmail.js';
import { buildTaskUrl } from './taskUrl.js';
import { parseMentions } from '../task/parseMentions.js';
import { markdownToTelegramHtml } from '../telegram/telegramMarkdown.js';

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
    // Ответ/цитата (db/080). Автор родительского коммента входит в аудиторию mode='all'.
    readonly replyToCommentId?: string | null;
  };
};

type Deps = {
  readonly members: ProjectMemberRepository;
  readonly projects: ProjectRepository;
  readonly tasks: TaskRepository;
  readonly comments: Pick<TaskCommentRepository, 'getById'>;
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
// comment_notifications. Резолвит получателей по выбору автора (audience — см. resolveBase),
// всегда добавляет упомянутых (@mention) поверх базы в обоих каналах, шлёт email + Telegram,
// записывает исход каждого (recipient × channel).
// Best-effort: исключения глотаются, журнал — фактический.
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

    // Упомянутые (@mention) — всегда получают email, даже если не в base и при pref-off.
    const mentionedIds = new Set(parseMentions(comment.body, members, input.actorUserId));

    // База адресации (для обоих каналов) по выбору автора. Assignee типизирован как
    // обязательный, но задача могла не найтись (удалена) — оптчейн вместо падения рассылки.
    const base = await this.resolveBase(nonActor, input, task?.assignee?.userId ?? null);
    const baseIds = new Set(base.map((m) => m.userId));

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

    // --- Telegram-канал: base (kind 'comment_on_my_task') + упомянутые (kind 'mention') ---
    const tgText =
      `💬 Новый комментарий в «${escapeTgHtml(projectName)}»:\n` +
      `<i>${markdownToTelegramHtml(tgExcerpt(comment.body))}</i>\n\n` +
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

    // Mentions used to reach Telegram only as a side effect of the blanket 'all' fan-out.
    // Now that 'all' is narrowed to the people involved, a mentioned bystander would lose
    // Telegram entirely — while the 'mention' pref is on by default and promises delivery.
    // Hence an explicit branch with kind 'mention' (mapped to the 'mention' pref in
    // TG_KIND_TO_PREF, so it stays switchable off by the user).
    const tgMentionText =
      `💬 Вас упомянули в комментарии в «${escapeTgHtml(projectName)}»:\n` +
      `<i>${markdownToTelegramHtml(tgExcerpt(comment.body))}</i>\n\n` +
      `<a href="${url}">Открыть комментарий</a>`;

    // Only for mode 'all': 'selected'/'none' are an explicit narrowing by the author and
    // never delivered mentions over Telegram before either.
    const tgMentionTargets =
      input.audience.mode === 'all'
        ? nonActor.filter((m) => mentionedIds.has(m.userId) && !baseIds.has(m.userId))
        : [];
    for (const m of tgMentionTargets) {
      try {
        const r = await this.deps.tgSend.execute({
          userId: m.userId,
          text: tgMentionText,
          parseMode: 'HTML',
          kind: 'mention',
          taskId: comment.taskId,
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

  // Audience resolution.
  //
  // 'none'/'selected' are an explicit choice of the comment author and stay as they were.
  //
  // 'all' used to mean "every row of members.listByProject()". After the move to a single
  // workspace (unified-workspace) listByProject reads membership through workspace_members,
  // i.e. it returns EVERY member of the workspace — so every comment was blasted to people
  // who have nothing to do with the task. Same regression that was fixed for status changes
  // in BroadcastTelegramNotificationByTask.
  //
  // 'all' now means "everyone actually involved in this comment": the task assignee plus the
  // author of the comment being replied to. Mentioned users are added on top of the base by
  // each channel separately (e-mail: forced; Telegram: its own kind 'mention'), so they are
  // deliberately NOT part of the base here. The comment author is always excluded (nonActor).
  // An empty result is legitimate (unassigned task, no reply) and must not break the dispatch.
  private async resolveBase(
    nonActor: readonly ProjectMemberWithUser[],
    input: DispatchCommentInput,
    assigneeUserId: string | null,
  ): Promise<ProjectMemberWithUser[]> {
    const audience = input.audience;
    if (audience.mode === 'none') return [];
    if (audience.mode === 'selected') {
      const want = new Set(audience.userIds ?? []);
      return nonActor.filter((m) => want.has(m.userId));
    }

    const involved = new Set<string>();
    if (assigneeUserId) involved.add(assigneeUserId);
    const replyToAuthorId = await this.replyToAuthorId(input.comment.replyToCommentId ?? null);
    if (replyToAuthorId) involved.add(replyToAuthorId);

    // Intersect with the member list: only members carry the e-mail/prefs we need. An
    // assignee whose account is no longer in the workspace simply cannot be reached.
    return nonActor.filter((m) => involved.has(m.userId));
  }

  // Author of the comment being replied to. Best-effort: a missing/deleted parent must not
  // break the dispatch — the remaining recipients still get notified.
  private async replyToAuthorId(replyToCommentId: string | null): Promise<string | null> {
    if (!replyToCommentId) return null;
    try {
      const parent = await this.deps.comments.getById(replyToCommentId);
      return parent?.ownerUserId ?? null;
    } catch (e) {
      console.warn('[DispatchCommentNotifications] reply-to lookup failed:', e);
      return null;
    }
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
