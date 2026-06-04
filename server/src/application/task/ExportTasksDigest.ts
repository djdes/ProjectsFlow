import type { ListTasks } from './ListTasks.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { EmailSender } from '../notifications/EmailSender.js';
import type { SendAgentTelegramNotification } from '../telegram/SendAgentTelegramNotification.js';
import {
  buildDigestModel,
  renderDigestHtml,
  renderDigestMarkdownV2,
  renderDigestText,
} from './digest/buildTaskDigest.js';

export type DigestChannel = 'clipboard' | 'email' | 'telegram';
export type DigestRecipient = { readonly kind: 'self' } | { readonly kind: 'user'; readonly userId: string };

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
  // Access-check + delegation-обогащение задач делается внутри ListTasks.
  readonly listTasks: ListTasks;
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly users: UserRepository;
  readonly email: EmailSender;
  readonly telegram: SendAgentTelegramNotification;
  readonly appUrl: string;
};

// Экспорт выбранных задач в дайджест: вернуть текст (буфер) и/или отправить на
// email / в Telegram. Сервер сам рендерит из авторитетных данных (клиент не шлёт
// произвольный текст), получатели валидируются как участники проекта.
export class ExportTasksDigest {
  constructor(private readonly deps: Deps) {}

  async execute(cmd: ExportTasksDigestCommand): Promise<ExportTasksDigestResult> {
    // ListTasks гейтит доступ (read_project) и джойнит активные делегации.
    const all = await this.deps.listTasks.execute(cmd.projectId, cmd.ownerUserId);
    const wanted = new Set(cmd.taskIds);
    const selected = all.filter((t) => wanted.has(t.id));

    const project = await this.deps.projects.getById(cmd.projectId);
    const projectName = project?.name ?? 'проект';
    const isInbox = project?.isInbox ?? false;

    const model = buildDigestModel(selected, { projectName, appUrl: this.deps.appUrl, isInbox });
    const text = renderDigestText(model);

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
    const markdown = renderDigestMarkdownV2(model);

    const delivered: { userId: string; channel: DigestChannel }[] = [];
    const skipped: { userId: string; reason: string }[] = [];
    const seen = new Set<string>();

    for (const r of cmd.recipients) {
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
        const res = await this.deps.telegram.execute({
          userId,
          text: markdown,
          parseMode: 'MarkdownV2',
          kind: 'task_digest',
          // Пользователь явно нажал «отправить» — не глушим 60с-дедупом.
          skipDedupCheck: true,
        });
        if (res.status === 'ok') delivered.push({ userId, channel: 'telegram' });
        else skipped.push({ userId, reason: res.status });
      }
    }

    return { text, delivery: { delivered, skipped } };
  }
}
