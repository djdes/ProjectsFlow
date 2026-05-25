import type { TelegramClient } from './TelegramClient.js';
import type { TelegramOutboundRepository } from './TelegramOutboundRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
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
  readonly replyMarkup?: unknown;
  // Защита от лавины: если за prev 60с уже было успешное сообщение того же kind+task —
  // skip. Можно отключить если caller сам управляет дедупом.
  readonly skipDedupCheck?: boolean;
  // v2: явный override prefs (caller знает что хочет — например high-priority алерт
  // или admin-override). По умолчанию prefs учитываются.
  readonly skipPrefsCheck?: boolean;
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

    const send = await this.deps.client.sendMessage({
      chatId: link.tgChatId,
      text: cmd.text,
      parseMode: cmd.parseMode ?? 'HTML',
      replyMarkup: cmd.replyMarkup,
      disableWebPagePreview: true,
    });

    if (send.kind === 'ok') {
      await this.audit(cmd, link.tgChatId, 'ok', send.messageId, null);
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
