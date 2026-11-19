import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import { requireDispatcherAccess } from '../project/projectAccess.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import type { TelegramClient } from './TelegramClient.js';
import type { TelegramRalphQuestionRepository } from './TelegramRalphQuestionRepository.js';
import { TaskNotFoundError } from '../../domain/task/errors.js';
import { escapeTelegramHtml } from './telegramMarkdown.js';
import { incidentSigningKey, readIncidentOrigin } from './composer/incidentIntake.js';

// Сообщение воркера автору инцидента (spec 2026-11-17, раздел 3): вопрос-уточнение или
// «не получилось» — в ту же группу, reply'ем на исходное сообщение автора. Текст оформляет
// сервер (простым языком, как CSharpFixer), воркер передаёт только сам вопрос. Ответ автора
// reply'ем на вопрос HandleTelegramWebhook превращает в комментарий <!-- ralph-answer -->.
export const INCIDENT_NOTIFY_KINDS = ['incident_question', 'incident_blocked'] as const;
export type IncidentNotifyKind = (typeof INCIDENT_NOTIFY_KINDS)[number];

export type NotifyIncidentGroupCommand = {
  readonly actorUserId: string;
  readonly taskId: string;
  readonly kind: IncidentNotifyKind;
  readonly text: string;
  readonly ralphQuestionId?: string;
};

export type NotifyIncidentGroupResult =
  | { readonly status: 'ok'; readonly chatId: number; readonly messageId: number }
  | { readonly status: 'not_incident' }
  | { readonly status: 'rate_limited'; readonly retryAfter: number }
  | { readonly status: 'forbidden' | 'error'; readonly description: string };

type Deps = {
  readonly tasks: Pick<TaskRepository, 'getById'>;
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly client: Pick<TelegramClient, 'sendMessage'>;
  readonly incidentChats: { isIncident(chatId: number): Promise<boolean> };
  readonly ralphQuestionMessages: Pick<TelegramRalphQuestionRepository, 'upsert'>;
  readonly signingKey?: () => string | null;
};

export function incidentMessageText(
  kind: IncidentNotifyKind,
  author: { readonly userId: number; readonly senderName: string },
  text: string,
): string {
  const who = escapeTelegramHtml(author.senderName.trim() || 'Автор запроса');
  const mention = `<a href="tg://user?id=${author.userId}">${who}</a>`;
  if (kind === 'incident_blocked') {
    // Причину воркер пишет простым языком для автора: без неё автор не знает, что прислать.
    // Шаблонный текст воркера не дублируем.
    const reason = escapeTelegramHtml(text.replace(/<!--[\s\S]*?-->/g, '').trim()).slice(0, 1500);
    const generic = !reason || reason === '-' || reason.includes('передали разработчику');
    return `${mention}\n⚠️ Автоматически сделать не удалось, задачу передали разработчику.${generic ? '' : `\n\n${reason}`}`;
  }
  const question = escapeTelegramHtml(text.replace(/<!--[\s\S]*?-->/g, '').trim()).slice(0, 3500);
  return `${mention}\n❓ Нужно небольшое уточнение:\n${question}\n\nОтветьте прямо на это сообщение, и я продолжу.`;
}

export class NotifyIncidentGroup {
  constructor(private readonly deps: Deps) {}

  async execute(cmd: NotifyIncidentGroupCommand): Promise<NotifyIncidentGroupResult> {
    const task = await this.deps.tasks.getById(cmd.taskId);
    if (!task || task.deletedAt) throw new TaskNotFoundError(cmd.taskId);
    // Писать в чужую группу от имени бота может только диспетчер проекта задачи.
    await requireDispatcherAccess(this.deps, task.projectId, cmd.actorUserId);
    const origin = readIncidentOrigin(task.description ?? '', (this.deps.signingKey ?? incidentSigningKey)());
    // Задачу перенесли в другой проект или подпись чужая — в группу не пишем.
    if (!origin || origin.projectId !== task.projectId) return { status: 'not_incident' };
    if (!(await this.deps.incidentChats.isIncident(origin.chatId).catch(() => false))) return { status: 'not_incident' };
    if (cmd.kind === 'incident_question' && !cmd.ralphQuestionId) return { status: 'error', description: 'ralphQuestionId required' };

    const send = await this.deps.client.sendMessage({
      chatId: origin.chatId,
      replyToMessageId: origin.messageId,
      text: incidentMessageText(cmd.kind, origin, cmd.text),
      parseMode: 'HTML',
      disableWebPagePreview: true,
    });
    if (send.kind === 'rate_limited') return { status: 'rate_limited', retryAfter: send.retryAfter };
    if (send.kind !== 'ok') return { status: send.kind === 'forbidden' ? 'forbidden' : 'error', description: send.description };
    if (cmd.kind === 'incident_question' && cmd.ralphQuestionId) {
      // Ответ reply'ем ляжет комментарием от того, на кого заведена задача (у автора из
      // группы аккаунта может не быть); реальное имя автора — в тексте комментария.
      try {
        await this.deps.ralphQuestionMessages.upsert({
          tgChatId: origin.chatId,
          tgMessageId: send.messageId,
          recipientUserId: task.assignee.userId,
          taskId: task.id,
          ralphQuestionId: cmd.ralphQuestionId,
        });
      } catch (err) {
        console.warn('[tg-incident] question mapping failed:', err);
      }
    }
    return { status: 'ok', chatId: origin.chatId, messageId: send.messageId };
  }
}
