import type { TelegramClient } from './TelegramClient.js';
import type { TelegramOutboundRepository } from './TelegramOutboundRepository.js';
import type { TelegramRalphQuestionRepository } from './TelegramRalphQuestionRepository.js';
import type { TelegramTaskMessageRepository } from './TelegramTaskMessageRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { TaskRepository } from '../task/TaskRepository.js';
import { TASK_ACTION_KINDS, taskActionKeyboard, taskViewKeyboard } from './taskActionKeyboard.js';
import {
  resolveTgPref,
  type TelegramNotifKind,
} from '../../domain/telegram/TelegramNotificationPrefs.js';

export type SendAgentNotificationCommand = {
  readonly userId: string;
  readonly text: string;
  readonly parseMode?: 'HTML' | 'MarkdownV2';
  // Маппится в TelegramNotifKind для prefs-чека. Если передан произвольный kind (например
  // 'ralph_question_reminder') — без prefs-чека всегда отправляем (это agent-level kind,
  // не настраиваемый юзером); audit log сохранит как есть.
  readonly kind: string;
  readonly taskId?: string;
  // Проект задачи — нужен для регистрации reply→комментарий (telegram_task_messages) и
  // авто-клавиатуры «Завершить/Комментировать». Без него авто-действия не прицепляются.
  readonly projectId?: string;
  readonly replyMarkup?: unknown;
  // Защита от лавины: если за prev 60с уже было успешное сообщение того же kind+task —
  // skip. Можно отключить если caller сам управляет дедупом.
  readonly skipDedupCheck?: boolean;
  // v2: явный override prefs (caller знает что хочет — например high-priority алерт
  // или admin-override). По умолчанию prefs учитываются.
  readonly skipPrefsCheck?: boolean;
  // Spec telegram-reply-to-ralph-answer.md: для kind ∈ {ralph_question,
  // ralph_question_reminder} caller пробрасывает id вопроса из <!-- ralph-question
  // {"id":"..."} -->. При успешном send'е (status='ok') бэк сохраняет маппинг
  // (chat_id, message_id) → (task_id, question_id), чтобы webhook потом мог найти
  // привязку при reply'е от юзера. Если поле не задано — мэппинг не пишется.
  readonly ralphQuestionId?: string;
  // Подписанные URL картинок из описания задачи. Если заданы — после текста шлём альбомом
  // (в тексте Telegram картинку между абзацев не вставить). Best-effort.
  readonly imageUrls?: readonly string[];
};

// Дискриминированный результат — caller (route) мапит в HTTP-код.
export type SendAgentNotificationResult =
  | { readonly status: 'ok'; readonly messageId: number; readonly chatId: number }
  | { readonly status: 'not_connected' } // 410: нет TG-привязки у юзера
  | { readonly status: 'not_started' } // 410: юзер не нажал /start
  | { readonly status: 'pref_off'; readonly kind: TelegramNotifKind } // 200 skipped
  | { readonly status: 'dedup' } // 200 skipped
  | { readonly status: 'rate_limited'; readonly retryAfter: number } // 429
  | { readonly status: 'forbidden'; readonly description: string } // 410, юзер заблокировал бота
  | { readonly status: 'error'; readonly description: string }; // 500

type Deps = {
  readonly users: UserRepository;
  readonly client: TelegramClient;
  readonly outbound: TelegramOutboundRepository;
  // Маппинг (chat,message)→(task,question) для последующего матча reply'я. Optional —
  // если caller не передаёт ralphQuestionId, никаких записей не будет. Тип nullable
  // вместо optional чтобы было ясно при wiring'е что фича есть.
  readonly ralphQuestionMessages: TelegramRalphQuestionRepository;
  // Маппинг (chat,message)→(task,project) для reply→комментарий (db/049). Пишется при
  // успешной отправке задачного уведомления (kind ∈ TASK_ACTION_KINDS + projectId).
  readonly taskMessages: TelegramTaskMessageRepository;
  // Для задачных уведомлений: если задача уже done — вместо «Завершить» показываем «Посмотреть».
  readonly tasks: TaskRepository;
  readonly idGen: () => string;
  // Знакомые kinds мапятся в pref-toggle; остальные шлются без pref-чека.
  readonly kindToPref: Partial<Record<string, TelegramNotifKind>>;
};

export class SendAgentTelegramNotification {
  constructor(private readonly deps: Deps) {}

  async execute(cmd: SendAgentNotificationCommand): Promise<SendAgentNotificationResult> {
    const link = await this.deps.users.getTelegramLink(cmd.userId);
    if (!link) return { status: 'not_connected' };
    if (link.tgChatId === null || link.tgStartedAt === null) {
      return { status: 'not_started' };
    }

    // Prefs-чек: только для известных kinds. skipPrefsCheck — override (v2).
    const prefKind = this.deps.kindToPref[cmd.kind];
    if (!cmd.skipPrefsCheck && prefKind && !resolveTgPref(link.prefs, prefKind)) {
      await this.audit(cmd, link.tgChatId, 'skipped_pref_off', null, null);
      return { status: 'pref_off', kind: prefKind };
    }

    // Дедуп: одинаковые kind+task в течение 60с (по успешным отправкам).
    if (!cmd.skipDedupCheck) {
      const recent = await this.deps.outbound.existsRecent(
        cmd.userId,
        cmd.kind,
        cmd.taskId ?? null,
        60,
      );
      if (recent) {
        await this.audit(cmd, link.tgChatId, 'skipped_dedup', null, null);
        return { status: 'dedup' };
      }
    }

    // Задачное уведомление (kind ∈ allowlist + есть task/project) → авто-действия
    // «Завершить/Комментировать» + reply-комментирование. Явный replyMarkup от caller'а
    // (например «Принять/Отказать» у делегирования) не перетираем.
    const taskActions = Boolean(
      cmd.taskId && cmd.projectId && TASK_ACTION_KINDS.has(cmd.kind),
    );
    let autoKeyboard: unknown = undefined;
    if (taskActions && !cmd.replyMarkup) {
      // Уже завершённую задачу (напр. уведомление «статус → Готово») незачем «Завершать» —
      // показываем «Посмотреть». Сбой чтения статуса не критичен → обычные действия.
      let done = false;
      try {
        const t = await this.deps.tasks.getById(cmd.taskId!);
        done = t?.status === 'done';
      } catch {
        done = false;
      }
      autoKeyboard = done ? taskViewKeyboard(cmd.taskId!) : taskActionKeyboard(cmd.taskId!);
    }
    const replyMarkup = cmd.replyMarkup ?? autoKeyboard;

    const send = await this.deps.client.sendMessage({
      chatId: link.tgChatId,
      text: cmd.text,
      parseMode: cmd.parseMode ?? 'HTML',
      replyMarkup,
      disableWebPagePreview: true,
    });

    if (send.kind === 'ok') {
      await this.audit(cmd, link.tgChatId, 'ok', send.messageId, null);
      // Картинки описания — альбомом после текста (best-effort, не влияет на статус send'а).
      if (cmd.imageUrls && cmd.imageUrls.length > 0) {
        await this.deps.client.sendPhotos?.(link.tgChatId, cmd.imageUrls).catch(() => {});
      }
      // Маппинг для ralph_question reply-handling. Best-effort: ошибка БД не должна
      // ломать уже успешно отправленное сообщение (юзер увидит TG-сообщение в любом
      // случае; в худшем — его reply не зашьётся, но это лучше чем фейл send'а).
      if (cmd.ralphQuestionId && cmd.taskId) {
        try {
          await this.deps.ralphQuestionMessages.upsert({
            tgChatId: link.tgChatId,
            tgMessageId: send.messageId,
            recipientUserId: cmd.userId,
            taskId: cmd.taskId,
            ralphQuestionId: cmd.ralphQuestionId,
          });
        } catch (err) {
          console.warn('[tg-notif] ralphQuestionMessage upsert failed:', err);
        }
      }
      // Reply→комментарий на задачное уведомление (db/049). Best-effort: сбой БД не должен
      // ломать уже успешно отправленное сообщение.
      if (taskActions && cmd.taskId && cmd.projectId) {
        try {
          await this.deps.taskMessages.upsert({
            tgChatId: link.tgChatId,
            tgMessageId: send.messageId,
            recipientUserId: cmd.userId,
            taskId: cmd.taskId,
            projectId: cmd.projectId,
          });
        } catch (err) {
          console.warn('[tg-notif] taskMessage upsert failed:', err);
        }
      }
      return { status: 'ok', messageId: send.messageId, chatId: link.tgChatId };
    }
    if (send.kind === 'forbidden') {
      // Юзер заблокировал бота или удалил аккаунт → tg_started_at сбрасываем,
      // UI покажет «нужно нажать Start снова».
      await this.deps.users.clearTelegramStarted(cmd.userId);
      await this.audit(cmd, link.tgChatId, 'forbidden', null, send.description);
      return { status: 'forbidden', description: send.description };
    }
    if (send.kind === 'rate_limited') {
      await this.audit(cmd, link.tgChatId, 'rate_limited', null, `retry_after=${send.retryAfter}`);
      return { status: 'rate_limited', retryAfter: send.retryAfter };
    }
    await this.audit(cmd, link.tgChatId, 'error', null, send.description);
    return { status: 'error', description: send.description };
  }

  private audit(
    cmd: SendAgentNotificationCommand,
    chatId: number,
    status:
      | 'ok'
      | 'forbidden'
      | 'rate_limited'
      | 'error'
      | 'skipped_dedup'
      | 'skipped_pref_off',
    messageId: number | null,
    errorText: string | null,
  ): Promise<void> {
    return this.deps.outbound.create({
      id: this.deps.idGen(),
      userId: cmd.userId,
      chatId,
      eventKind: cmd.kind,
      taskId: cmd.taskId ?? null,
      messageId,
      status,
      errorText,
    });
  }
}
