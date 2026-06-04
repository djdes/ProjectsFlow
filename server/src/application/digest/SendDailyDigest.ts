import type { TaskRepository } from '../task/TaskRepository.js';
import type { TaskDelegationRepository } from '../task/TaskDelegationRepository.js';
import type { TaskWithCounts } from '../task/ListTasks.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { EmailSender } from '../notifications/EmailSender.js';
import type { NotificationRepository } from '../notifications/NotificationRepository.js';
import type { SendAgentTelegramNotification } from '../telegram/SendAgentTelegramNotification.js';
import type { TelegramClient } from '../telegram/TelegramClient.js';
import type { DigestSettingsRepository } from './DigestSettingsRepository.js';
import {
  buildDigestModel,
  renderDigestHtml,
  renderDigestMarkdown,
  renderDigestTelegram,
} from '../task/digest/buildTaskDigest.js';
import { toVisibleStatus } from '../../domain/task/digestFormat.js';

type Deps = {
  readonly tasks: TaskRepository;
  readonly delegations: TaskDelegationRepository;
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly email: EmailSender;
  readonly notifications: NotificationRepository;
  readonly telegram: SendAgentTelegramNotification; // личка участникам
  readonly telegramClient: TelegramClient; // группа
  readonly settings: DigestSettingsRepository;
  readonly appUrl: string;
  readonly idGen: () => string;
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
    const wanted = new Set(cfg.statuses);
    const selected = all.filter((t) => wanted.has(toVisibleStatus(t.status)));
    if (selected.length === 0) return { taskCount: 0 };

    const delegations = await this.deps.delegations.listActiveForTasks(selected.map((t) => t.id));
    const enriched: TaskWithCounts[] = selected.map((t) => ({
      ...t,
      commitCount: 0,
      attachmentCount: 0,
      commentCount: 0,
      delegation: delegations.get(t.id) ?? null,
    }));

    const model = buildDigestModel(enriched, {
      projectName: project.name,
      appUrl: this.deps.appUrl,
      isInbox: project.isInbox,
      attachmentsByTask: new Map(),
      grouping: { by: 'status', statuses: cfg.statuses },
    });

    const subject = `Ежедневная сводка · ${project.name}`;
    const html = renderDigestHtml(model);
    const text = renderDigestMarkdown(model);
    const tgPersonal = renderDigestTelegram(model);
    const tgGroup = renderDigestTelegram(model, { assigneeFirst: true });

    const members = await this.deps.members.listByProject(projectId);
    const memberById = new Map(members.map((m) => [m.userId, m] as const));
    const recipients = cfg.recipientUserIds.filter((id) => memberById.has(id));

    for (const userId of recipients) {
      const member = memberById.get(userId)!;
      if (cfg.channels.includes('email') && member.user.email) {
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
        await this.deps.telegram
          .execute({ userId, text: tgPersonal, parseMode: 'HTML', kind: 'task_digest', skipDedupCheck: true })
          .catch((e) => console.warn('[daily-digest] tg personal failed', userId, e));
      }
    }

    // Группа — одно сообщение на всю команду.
    if (
      cfg.channels.includes('telegram') &&
      cfg.tgTargets.includes('group') &&
      settings.telegramGroupChatId !== null
    ) {
      await this.deps.telegramClient
        .sendMessage({
          chatId: settings.telegramGroupChatId,
          text: tgGroup,
          parseMode: 'HTML',
          disableWebPagePreview: true,
        })
        .catch((e) => console.warn('[daily-digest] tg group failed', e));
    }

    return { taskCount: selected.length };
  }
}
