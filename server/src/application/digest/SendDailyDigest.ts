import type { TaskRepository } from '../task/TaskRepository.js';
import type { TaskDelegationRepository } from '../task/TaskDelegationRepository.js';
import type { TaskCommentRepository } from '../task/TaskCommentRepository.js';
import type { TaskWithCounts } from '../task/ListTasks.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { EmailSender } from '../notifications/EmailSender.js';
import type { NotificationRepository } from '../notifications/NotificationRepository.js';
import type { SendAgentTelegramNotification } from '../telegram/SendAgentTelegramNotification.js';
import type { TelegramClient } from '../telegram/TelegramClient.js';
import type { DigestSettingsRepository } from './DigestSettingsRepository.js';
import type { CreateEmailActionToken } from '../email-action/CreateEmailActionToken.js';
import {
  buildDigestModel,
  renderDigestHtml,
  renderDigestMarkdown,
  renderDigestTelegram,
} from '../task/digest/buildTaskDigest.js';
import { toVisibleStatus } from '../../domain/task/digestFormat.js';
import type { TaskStatus } from '../../domain/task/Task.js';

type Deps = {
  readonly tasks: TaskRepository;
  readonly delegations: TaskDelegationRepository;
  readonly comments: TaskCommentRepository;
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly email: EmailSender;
  readonly notifications: NotificationRepository;
  readonly telegram: SendAgentTelegramNotification; // личка участникам
  readonly telegramClient: TelegramClient; // группа
  readonly settings: DigestSettingsRepository;
  readonly appUrl: string;
  readonly idGen: () => string;
  // Токен-ссылки one-click действий в письме (своя на каждого получателя × задачу).
  readonly createEmailActionToken: CreateEmailActionToken;
};

// Отправка ежедневной сводки по проекту (вызывается планировщиком). Полностью
// серверная: строит сводку по выбранным колонкам и рассылает по выбранным каналам.
// Best-effort: ошибка одного канала/получателя не валит остальные.
export class SendDailyDigest {
  constructor(private readonly deps: Deps) {}

  // force=true — отправить немедленно даже если сводка выключена (кнопка «Отправить сейчас»).
  // Возвращает число задач в сводке (0 = нечего слать / выключено).
  async execute(projectId: string, opts: { force?: boolean } = {}): Promise<{ taskCount: number }> {
    const settings = await this.deps.settings.getByProject(projectId);
    const cfg = settings.daily;
    if (!opts.force && !cfg.enabled) return { taskCount: 0 };

    const project = await this.deps.projects.getById(projectId);
    if (!project) return { taskCount: 0 };

    const all = await this.deps.tasks.listByProject(projectId);
    // Выполненные (done) задачи в сводку НЕ включаем (во всех каналах) — сводка про «что делать».
    // Аннотация TaskStatus[] обязательна: TS сужает .filter через inferred predicate, иначе
    // Set<...без done> и .has(toVisibleStatus) ругается на 'done'.
    const statuses: TaskStatus[] = cfg.statuses.filter((s) => s !== 'done');
    const wanted = new Set(statuses);
    const selected = all.filter((t) => t.status !== 'done' && wanted.has(toVisibleStatus(t.status)));
    if (selected.length === 0) return { taskCount: 0 };

    const [delegations, commentCounts] = await Promise.all([
      this.deps.delegations.listActiveForTasks(selected.map((t) => t.id)),
      this.deps.comments.countsByTasks(selected.map((t) => t.id)),
    ]);
    const enriched: TaskWithCounts[] = selected.map((t) => ({
      ...t,
      commitCount: 0,
      attachmentCount: 0,
      commentCount: commentCounts.get(t.id) ?? 0,
      delegation: delegations.get(t.id) ?? null,
    }));

    const model = buildDigestModel(enriched, {
      projectName: project.name,
      appUrl: this.deps.appUrl,
      isInbox: project.isInbox,
      attachmentsByTask: new Map(),
      grouping: { by: 'status', statuses },
    });

    const subject = `Ежедневная сводка · ${project.name}`;
    const base = this.deps.appUrl.replace(/\/+$/, '');
    const text = renderDigestMarkdown(model);
    // Telegram: массив сообщений (длинная сводка разбивается, все задачи целиком).
    const tgChunks = renderDigestTelegram(model);

    const members = await this.deps.members.listByProject(projectId);
    const memberById = new Map(members.map((m) => [m.userId, m] as const));
    const recipients = cfg.recipientUserIds.filter((id) => memberById.has(id));

    for (const userId of recipients) {
      const member = memberById.get(userId)!;
      if (cfg.channels.includes('email') && member.user.email) {
        // One-click токен-ссылки действий — свои на каждого получателя × задачу.
        const actionUrls = new Map<string, { completeUrl: string; commentUrl: string }>();
        for (const t of selected) {
          const [completeToken, commentToken] = await Promise.all([
            this.deps.createEmailActionToken.execute({ action: 'complete', taskId: t.id, projectId, userId }),
            this.deps.createEmailActionToken.execute({ action: 'comment', taskId: t.id, projectId, userId }),
          ]);
          actionUrls.set(t.id, {
            completeUrl: `${base}/api/email-actions/${completeToken}`,
            commentUrl: `${base}/api/email-actions/${commentToken}`,
          });
        }
        const html = renderDigestHtml(model, { actionUrls });
        await this.deps.email
          .send({ to: member.user.email, subject, html, text })
          .catch((e) => console.warn('[daily-digest] email failed', userId, e));
      }
      if (cfg.channels.includes('notification')) {
        await this.deps.notifications
          .create({
            id: this.deps.idGen(),
            userId,
            payload: {
              type: 'daily_digest',
              projectId,
              projectName: project.name,
              taskCount: selected.length,
            },
          })
          .catch((e) => console.warn('[daily-digest] notification failed', userId, e));
      }
      if (cfg.channels.includes('telegram') && cfg.tgTargets.includes('personal')) {
        // Личный TG — как письмо-дайджест: заголовок + карточка на задачу с инлайн-кнопками
        // «Завершить/Комментировать». Кнопки и reply→комментарий цепляет
        // SendAgentTelegramNotification по kind='task_digest_item' (+ taskId/projectId).
        const base = this.deps.appUrl.replace(/\/$/, '');
        await this.deps.telegram
          .execute({
            userId,
            text: `🗒 <b>Ежедневная сводка · ${escapeDigestHtml(project.name)}</b> — ${selected.length} задач`,
            parseMode: 'HTML',
            kind: 'task_digest',
            skipDedupCheck: true,
          })
          .catch((e) => console.warn('[daily-digest] tg personal header failed', userId, e));
        for (const t of selected.slice(0, TG_DIGEST_ACTION_LIMIT)) {
          await this.deps.telegram
            .execute({
              userId,
              text: `📌 ${escapeDigestHtml(digestExcerpt(t.description))}\n<i>${digestStatusLabel(t.status)}</i>`,
              parseMode: 'HTML',
              kind: 'task_digest_item',
              taskId: t.id,
              projectId,
              skipDedupCheck: true,
            })
            .catch((e) => console.warn('[daily-digest] tg personal card failed', userId, e));
        }
        if (selected.length > TG_DIGEST_ACTION_LIMIT) {
          const rest = selected.length - TG_DIGEST_ACTION_LIMIT;
          await this.deps.telegram
            .execute({
              userId,
              text: `… ещё ${rest}. <a href="${base}/projects/${projectId}">Открыть в приложении</a>`,
              parseMode: 'HTML',
              kind: 'task_digest',
              skipDedupCheck: true,
            })
            .catch((e) => console.warn('[daily-digest] tg personal tail failed', userId, e));
        }
      }
    }

    // Группа — те же сообщения на всю команду.
    if (
      cfg.channels.includes('telegram') &&
      cfg.tgTargets.includes('group') &&
      settings.telegramGroupChatId !== null
    ) {
      for (const chunk of tgChunks) {
        await this.deps.telegramClient
          .sendMessage({
            chatId: settings.telegramGroupChatId,
            text: chunk,
            parseMode: 'HTML',
            disableWebPagePreview: true,
          })
          .catch((e) => console.warn('[daily-digest] tg group failed', e));
      }
    }

    return { taskCount: selected.length };
  }
}

// Личный TG-дайджест: сколько задач показать отдельными карточками-действиями (остальное —
// ссылкой в приложение). Держим в разумных рамках, чтобы не спамить сообщениями.
const TG_DIGEST_ACTION_LIMIT = 12;

const VISIBLE_STATUS_LABEL: Record<string, string> = {
  backlog: 'Черновик',
  manual: 'Вручную',
  todo: 'Воркер',
  in_progress: 'В работе',
  awaiting_clarification: 'На уточнении',
  done: 'Готово',
};

function digestStatusLabel(status: TaskStatus): string {
  const v = toVisibleStatus(status);
  return VISIBLE_STATUS_LABEL[v] ?? v;
}

function digestExcerpt(description: string | null): string {
  const s = (description ?? '').trim().replace(/\s+/g, ' ');
  if (s.length === 0) return '(без описания)';
  return s.length <= 300 ? s : s.slice(0, 299).trimEnd() + '…';
}

function escapeDigestHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
