import type { ListTasks } from './ListTasks.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { TaskAttachmentRepository } from './TaskAttachmentRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { EmailSender } from '../notifications/EmailSender.js';
import type { SendAgentTelegramNotification } from '../telegram/SendAgentTelegramNotification.js';
import type { TelegramClient } from '../telegram/TelegramClient.js';
import type { DigestSettingsRepository } from '../digest/DigestSettingsRepository.js';
import {
  buildDigestModel,
  renderDigestHtml,
  renderDigestMarkdown,
  renderDigestTelegram,
  type DigestAttachment,
} from './digest/buildTaskDigest.js';

export type DigestChannel = 'clipboard' | 'email' | 'telegram';
export type DigestRecipient =
  | { readonly kind: 'self' }
  | { readonly kind: 'user'; readonly userId: string }
  // Telegram-группа проекта (chat_id из настроек дайджеста). Только для channel='telegram'.
  | { readonly kind: 'group' };

export type ExportTasksDigestCommand = {
  readonly projectId: string;
  readonly ownerUserId: string;
  readonly taskIds: readonly string[];
  readonly channel: DigestChannel;
  readonly recipients: readonly DigestRecipient[];
};

export type DigestDelivery = {
  readonly delivered: { userId: string; channel: DigestChannel }[];
  readonly skipped: { userId: string; reason: string }[];
};

export type ExportTasksDigestResult = {
  // Plain-text дайджест — всегда (для буфера; для email/telegram возвращаем тоже).
  readonly text: string;
  // Только для email/telegram — итог отправки.
  readonly delivery?: DigestDelivery;
};

type Deps = {
  // Access-check + загрузка ответственного делаются внутри ListTasks.
  readonly listTasks: ListTasks;
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly attachments: TaskAttachmentRepository;
  readonly users: UserRepository;
  readonly email: EmailSender;
  readonly telegram: SendAgentTelegramNotification;
  // Прямая отправка в Telegram-группу (chat_id из настроек), минуя per-user lookup.
  readonly telegramClient: TelegramClient;
  readonly settings: DigestSettingsRepository;
  readonly appUrl: string;
};

// Экспорт выбранных задач в дайджест: вернуть текст (буфер) и/или отправить на
// email / в Telegram. Сервер сам рендерит из авторитетных данных (клиент не шлёт
// произвольный текст), получатели валидируются как участники проекта.
export class ExportTasksDigest {
  constructor(private readonly deps: Deps) {}

  async execute(cmd: ExportTasksDigestCommand): Promise<ExportTasksDigestResult> {
    // ListTasks гейтит доступ (read_project) и возвращает обязательного ответственного.
    const all = await this.deps.listTasks.execute(cmd.projectId, cmd.ownerUserId);
    const wanted = new Set(cmd.taskIds);
    const selected = all.filter((t) => wanted.has(t.id));

    const project = await this.deps.projects.getById(cmd.projectId);
    const projectName = project?.name ?? 'проект';
    const isInbox = project?.isInbox ?? false;

    // Вложения каждой выбранной задачи — ссылками (буфер/почта/ТГ единообразно).
    const base = this.deps.appUrl.replace(/\/+$/, '');
    const attachmentsByTask = new Map<string, DigestAttachment[]>();
    for (const t of selected) {
      const atts = await this.deps.attachments.listByTask(t.id);
      attachmentsByTask.set(
        t.id,
        atts.map((a) => ({ name: a.filename, url: `${base}/api/attachments/${a.id}` })),
      );
    }

    const model = buildDigestModel(selected, {
      projectName,
      appUrl: this.deps.appUrl,
      isInbox,
      attachmentsByTask,
    });
    // text — Markdown (для буфера; добавляем и к ответу email/telegram).
    const text = renderDigestMarkdown(model);

    if (cmd.channel === 'clipboard') {
      return { text };
    }

    // Резолвим получателей: 'self' → caller (разрешён всегда); {userId} → обязан быть
    // участником проекта (анти-абуз: нельзя слать произвольным пользователям).
    const members = await this.deps.members.listByProject(cmd.projectId);
    const emailByUser = new Map(members.map((m) => [m.userId, m.user.email] as const));
    const memberIds = new Set(members.map((m) => m.userId));

    const subject = `Задачи (${model.count}) · ${projectName}`;
    const html = renderDigestHtml(model);
    // Telegram-формат: массив сообщений (длинная сводка разбивается, без обрезки).
    const telegramChunks = renderDigestTelegram(model);

    const delivered: { userId: string; channel: DigestChannel }[] = [];
    const skipped: { userId: string; reason: string }[] = [];
    const seen = new Set<string>();

    for (const r of cmd.recipients) {
      // Telegram-группа: шлём напрямую в chat_id, с ответственным в начале задачи.
      if (r.kind === 'group') {
        if (cmd.channel !== 'telegram') {
          skipped.push({ userId: 'group', reason: 'group_telegram_only' });
          continue;
        }
        if (seen.has('group')) continue;
        seen.add('group');
        const settings = await this.deps.settings.getByProject(cmd.projectId);
        if (settings.telegramGroupChatId === null) {
          skipped.push({ userId: 'group', reason: 'no_group' });
          continue;
        }
        let groupOk = true;
        let groupFail = '';
        for (const chunk of telegramChunks) {
          const res = await this.deps.telegramClient.sendMessage({
            chatId: settings.telegramGroupChatId,
            text: chunk,
            parseMode: 'HTML',
            disableWebPagePreview: true,
          });
          if (res.kind !== 'ok') {
            groupOk = false;
            groupFail = res.kind;
            break;
          }
        }
        if (groupOk) delivered.push({ userId: 'group', channel: 'telegram' });
        else skipped.push({ userId: 'group', reason: groupFail });
        continue;
      }
      const userId = r.kind === 'self' ? cmd.ownerUserId : r.userId;
      if (seen.has(userId)) continue;
      seen.add(userId);
      if (r.kind === 'user' && !memberIds.has(userId)) {
        skipped.push({ userId, reason: 'not_member' });
        continue;
      }

      if (cmd.channel === 'email') {
        let to = emailByUser.get(userId) ?? null;
        if (!to) {
          // self при admin-bypass может не быть в members — резолвим напрямую.
          const u = await this.deps.users.getById(userId);
          to = u?.email ?? null;
        }
        if (!to) {
          skipped.push({ userId, reason: 'no_email' });
          continue;
        }
        try {
          await this.deps.email.send({ to, subject, html, text });
          delivered.push({ userId, channel: 'email' });
        } catch {
          skipped.push({ userId, reason: 'email_failed' });
        }
      } else {
        let tgOk = true;
        let tgFail = '';
        for (const chunk of telegramChunks) {
          const res = await this.deps.telegram.execute({
            userId,
            text: chunk,
            parseMode: 'HTML',
            kind: 'task_digest',
            // Пользователь явно нажал «отправить» — не глушим 60с-дедупом.
            skipDedupCheck: true,
          });
          if (res.status !== 'ok') {
            tgOk = false;
            tgFail = res.status;
            break;
          }
        }
        if (tgOk) delivered.push({ userId, channel: 'telegram' });
        else skipped.push({ userId, reason: tgFail });
      }
    }

    return { text, delivery: { delivered, skipped } };
  }
}
