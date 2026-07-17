import type { TaskRepository } from '../task/TaskRepository.js';
import type { TaskCommentRepository } from '../task/TaskCommentRepository.js';
import type { TaskWithCounts } from '../task/ListTasks.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { EmailSender } from '../notifications/EmailSender.js';
import type { NotificationRepository } from '../notifications/NotificationRepository.js';
import type { SendAgentTelegramNotification } from '../telegram/SendAgentTelegramNotification.js';
import type { TelegramClient } from '../telegram/TelegramClient.js';
import type { UserRepository } from '../user/UserRepository.js';
import type {
  DigestSettingsRepository,
  DigestTestDelivery,
} from './DigestSettingsRepository.js';
import type { CreateEmailActionToken } from '../email-action/CreateEmailActionToken.js';
import type { TelegramDigestActionDeliveryRepository } from './TelegramDigestActionDeliveryRepository.js';
import { extractTelegramDigestActionTokens } from './TelegramDigestActionService.js';
import { markdownToTelegramHtml } from '../telegram/telegramMarkdown.js';
import {
  buildDigestModel,
  renderDigestHtml,
  renderDigestMarkdown,
  renderDigestRich,
  renderDigestTelegram,
} from '../task/digest/buildTaskDigest.js';
import {
  extractImageSrcs,
  formatDeadlineRemainingRu,
  stripFigureLines,
  toVisibleStatus,
} from '../../domain/task/digestFormat.js';
import {
  makeAttachmentImageResolver,
  signAttachmentUrl,
} from '../attachments/signedAttachmentUrl.js';
import type { TaskStatus } from '../../domain/task/Task.js';

// Подписанные URL картинок живут 14 дней — письмо/сводку могут открыть не сразу.
const IMG_URL_TTL_SECONDS = 14 * 24 * 60 * 60;

type Deps = {
  readonly tasks: TaskRepository;
  readonly comments: TaskCommentRepository;
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly email: EmailSender;
  readonly notifications: NotificationRepository;
  readonly telegram: SendAgentTelegramNotification; // личка участникам
  readonly telegramClient: TelegramClient; // группа
  readonly users: UserRepository;
  readonly settings: DigestSettingsRepository;
  readonly appUrl: string;
  readonly idGen: () => string;
  // Токен-ссылки one-click действий в письме (своя на каждого получателя × задачу).
  readonly createEmailActionToken: CreateEmailActionToken;
  readonly telegramDigestActions: TelegramDigestActionDeliveryRepository;
  // Секрет для подписи URL картинок-вложений (письмо: <img>, Telegram: альбом).
  readonly signingSecret: string;
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

    // «Отправить сейчас» — тест автоматизации. Перед новым тестом удаляем сообщения
    // предыдущего теста во всех его чатах; плановые ежедневные сводки не затрагиваем.
    if (opts.force) await this.cleanupPreviousTest(projectId);

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

    const commentCounts = await this.deps.comments.countsByTasks(selected.map((t) => t.id));
    const enriched: TaskWithCounts[] = selected.map((t) => ({
      ...t,
      commitCount: 0,
      attachmentCount: 0,
      commentCount: commentCounts.get(t.id) ?? 0,
    }));

    const digestNow = new Date();
    const members = await this.deps.members.listByProject(projectId);
    const memberById = new Map(members.map((m) => [m.userId, m] as const));
    const telegramAssignees = new Map<
      string,
      { telegramUserId: number; username: string | null }
    >();
    if (cfg.tgGrouping === 'assignee') {
      const assigneeIds = [...new Set(selected.map((task) => task.assignee.userId))];
      await Promise.all(
        assigneeIds.map(async (userId) => {
          const link = await this.deps.users.getTelegramLink(userId).catch(() => null);
          if (link) {
            telegramAssignees.set(userId, {
              telegramUserId: link.telegramUserId,
              username: link.telegramUsername,
            });
          }
        }),
      );
    }
    const base = this.deps.appUrl.replace(/\/+$/, '');
    const telegramCompleteActionLinks = new Map<string, string>();
    if (
      cfg.channels.includes('telegram') &&
      cfg.tgTargets.includes('group') &&
      settings.telegramGroupChatId !== null
    ) {
      for (const task of selected) {
        const token = await this.deps.createEmailActionToken.execute({
          action: 'complete',
          taskId: task.id,
          projectId,
          userId: task.assignee.userId,
        });
        telegramCompleteActionLinks.set(
          task.id,
          `${base}/api/telegram-digest-actions/${token}`,
        );
      }
    }

    const model = buildDigestModel(enriched, {
      projectName: project.name,
      appUrl: this.deps.appUrl,
      isInbox: project.isInbox,
      attachmentsByTask: new Map(),
      grouping: { by: 'status', statuses },
      now: digestNow,
    });
    const telegramModel = buildDigestModel(enriched, {
      projectName: project.name,
      appUrl: this.deps.appUrl,
      isInbox: project.isInbox,
      attachmentsByTask: new Map(),
      grouping:
        cfg.tgGrouping === 'assignee'
          ? { by: 'assignee' }
          : { by: 'status', statuses },
      telegramAssignees,
      completeActionLinks: telegramCompleteActionLinks,
      now: digestNow,
    });

    const subject = `Ежедневная сводка · ${project.name}`;
    const text = renderDigestMarkdown(model);
    // Telegram: массив сообщений (длинная сводка разбивается, все задачи целиком).
    const tgChunks = renderDigestTelegram(telegramModel);
    // Резолвер картинок-вложений → подписанные URL (письмо: <img> в теле, TG: альбом на карточке).
    const nowMs = Date.now();
    const resolveImageUrl = makeAttachmentImageResolver(base, this.deps.signingSecret, IMG_URL_TTL_SECONDS, nowMs);

    const recipients = cfg.recipientUserIds.filter((id) => memberById.has(id));
    const testDeliveries = new Map<number, number[]>();
    const rememberTestMessage = (result: unknown): void => {
      if (!opts.force || !result || typeof result !== 'object') return;
      const value = result as { status?: unknown; kind?: unknown; chatId?: unknown; messageId?: unknown };
      const successful = value.status === 'ok' || value.kind === 'ok';
      if (!successful || typeof value.chatId !== 'number' || typeof value.messageId !== 'number') return;
      const ids = testDeliveries.get(value.chatId) ?? [];
      ids.push(value.messageId);
      testDeliveries.set(value.chatId, ids);
    };

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
        const html = renderDigestHtml(model, { actionUrls, resolveImageUrl });
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
        // Личный TG — заголовок + карточка на задачу. Действия живут компактными ссылками
        // прямо в тексте, без большой inline-клавиатуры под каждым сообщением.
        const base = this.deps.appUrl.replace(/\/$/, '');
        const headerResult = await this.deps.telegram
          .execute({
            userId,
            text: `🗒 <b>Ежедневная сводка · ${escapeDigestHtml(project.name)}</b> — ${selected.length} задач`,
            parseMode: 'HTML',
            kind: 'task_digest',
            skipDedupCheck: true,
          })
          .catch((e) => console.warn('[daily-digest] tg personal header failed', userId, e));
        rememberTestMessage(headerResult);
        for (const t of selected.slice(0, TG_DIGEST_ACTION_LIMIT)) {
          // Картинки задачи — альбомом после карточки (подписанные URL); из текста срезаны.
          const taskUrl = `${base}/${project.isInbox ? 'inbox' : `projects/${projectId}`}?task=${t.id}`;
          const imgUrls = extractImageSrcs(t.description)
            .map((s) => signAttachmentUrl(base, s, this.deps.signingSecret, IMG_URL_TTL_SECONDS, nowMs))
            .filter((u): u is string => u !== null);
          const itemResult = await this.deps.telegram
            .execute({
              userId,
              text:
                `📌 ${markdownToTelegramHtml(digestExcerpt(stripFigureLines(t.description)))}\n` +
                `<i>${digestStatusLabel(t.status)}</i>` +
                (t.deadline
                  ? `\n⏰ ${escapeDigestHtml(formatDeadlineRemainingRu(t.deadline, digestNow))}`
                  : '') +
                `\n<a href="${escapeDigestHtml(taskUrl)}">Открыть задачу</a>` +
                ` · <a href="${escapeDigestHtml(`${taskUrl}&done=1`)}">✓ Завершить</a>`,
              parseMode: 'HTML',
              kind: 'task_digest_item',
              taskId: t.id,
              projectId,
              skipDedupCheck: true,
              imageUrls: imgUrls,
            })
            .catch((e) => console.warn('[daily-digest] tg personal card failed', userId, e));
          rememberTestMessage(itemResult);
        }
        if (selected.length > TG_DIGEST_ACTION_LIMIT) {
          const rest = selected.length - TG_DIGEST_ACTION_LIMIT;
          const tailResult = await this.deps.telegram
            .execute({
              userId,
              text: `… ещё ${rest}. <a href="${base}/projects/${projectId}">Открыть в приложении</a>`,
              parseMode: 'HTML',
              kind: 'task_digest',
              skipDedupCheck: true,
            })
            .catch((e) => console.warn('[daily-digest] tg personal tail failed', userId, e));
          rememberTestMessage(tailResult);
        }
      }
    }

    // Группа — на всю команду. Сначала пробуем БОГАТУЮ карточку (Bot API 10.2 sendRichMessage:
    // закрытый details + мобильные списки, выделяемый текст). Фоллбэк на текстовые чанки, если
    // метод недоступен (старый API) или вернул ошибку (напр. слишком длинно).
    if (
      cfg.channels.includes('telegram') &&
      cfg.tgTargets.includes('group') &&
      settings.telegramGroupChatId !== null
    ) {
      const groupChatId = settings.telegramGroupChatId;
      const richHtml = renderDigestRich(telegramModel);
      let richOk = false;
      let fallbackAllowed = !this.deps.telegramClient.sendRichMessage;
      if (this.deps.telegramClient.sendRichMessage) {
        try {
          const r = await this.deps.telegramClient.sendRichMessage({
            chatId: groupChatId,
            html: richHtml,
          });
          richOk = r.kind === 'ok';
          fallbackAllowed = r.kind === 'error' && r.deliveryUnknown !== true;
          if (r.kind === 'ok') {
            rememberTestMessage({ ...r, chatId: groupChatId });
            await this.deps.telegramDigestActions
              .attach({
                tokens: extractTelegramDigestActionTokens(richHtml),
                chatId: groupChatId,
                messageId: r.messageId,
                messageHtml: richHtml,
                messageKind: 'rich',
              })
              .catch((e) =>
                console.warn('[daily-digest] remember rich actions failed', e),
              );
          }
        } catch (e) {
          console.warn('[daily-digest] tg group rich failed', e);
          // Сетевой сбой неоднозначен: запрос мог дойти до Telegram. Не посылаем второй
          // вариант вслед, иначе в группе появляются дубли.
          fallbackAllowed = false;
        }
      }
      if (!richOk && fallbackAllowed) {
        for (const chunk of tgChunks) {
          const result = await this.deps.telegramClient
            .sendMessage({
              chatId: groupChatId,
              text: chunk,
              parseMode: 'HTML',
              disableWebPagePreview: true,
            })
            .catch((e) => console.warn('[daily-digest] tg group failed', e));
          if (result && typeof result === 'object' && result.kind === 'ok') {
            rememberTestMessage({ ...result, chatId: groupChatId });
            await this.deps.telegramDigestActions
              .attach({
                tokens: extractTelegramDigestActionTokens(chunk),
                chatId: groupChatId,
                messageId: result.messageId,
                messageHtml: chunk,
                messageKind: 'html',
              })
              .catch((e) =>
                console.warn('[daily-digest] remember fallback actions failed', e),
              );
          }
        }
      }
    }

    if (opts.force) {
      const deliveries: DigestTestDelivery[] = [...testDeliveries.entries()].map(
        ([chatId, messageIds]) => ({ chatId, messageIds }),
      );
      await this.deps.settings
        .replaceLastTestDeliveries(projectId, deliveries)
        .catch((e) => console.warn('[daily-digest] remember test messages failed', e));
    }

    return { taskCount: selected.length };
  }

  private async cleanupPreviousTest(projectId: string): Promise<void> {
    const previous = await this.deps.settings.getLastTestDeliveries(projectId).catch(() => []);
    const remove = this.deps.telegramClient.deleteMessages;
    if (remove) {
      for (const delivery of previous) {
        await remove
          .call(this.deps.telegramClient, {
            chatId: delivery.chatId,
            messageIds: delivery.messageIds,
          })
          .catch((e) => console.warn('[daily-digest] delete previous test failed', e));
      }
    }
    await this.deps.settings
      .replaceLastTestDeliveries(projectId, [])
      .catch((e) => console.warn('[daily-digest] clear previous test refs failed', e));
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
