import type { SupportTicket, SupportTicketSource } from '../../domain/help/SupportTicket.js';
import type { SupportTicketRepository } from './SupportTicketRepository.js';
import type { TelegramClient } from '../telegram/TelegramClient.js';
import type { SendAgentTelegramNotification } from '../telegram/SendAgentTelegramNotification.js';
import type { UserRepository } from '../user/UserRepository.js';

// Куда ушла доставка тикета. saved_only — тикет в БД есть, но Telegram-канал недоступен
// (ни SUPPORT_TELEGRAM_CHAT_ID, ни админ с привязанным TG). Для логов/телеметрии.
export type SupportDeliveryChannel = 'telegram_chat' | 'admin_fallback' | 'saved_only';

export type SubmitSupportTicketInput = {
  // null — анонимная отправка с лендинга (пользователь не залогинен).
  readonly userId: string | null;
  readonly message: string;
  readonly source: SupportTicketSource;
};

export type SubmitSupportTicketResult = {
  readonly ticket: SupportTicket;
  readonly delivery: SupportDeliveryChannel;
};

type Deps = {
  readonly tickets: SupportTicketRepository;
  readonly users: UserRepository;
  readonly client: TelegramClient;
  readonly sendNotification: SendAgentTelegramNotification;
  // chat_id Telegram-чата поддержки (SUPPORT_TELEGRAM_CHAT_ID). null/NaN — не задан →
  // fallback на уведомление админам через их личную TG-привязку.
  readonly supportChatId: number | null;
};

// Экранирование под Telegram parse_mode=HTML (только &, <, > обязательны).
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const SOURCE_LABEL: Record<SupportTicketSource, string> = {
  app: 'приложение',
  landing: 'лендинг',
};

export class SubmitSupportTicket {
  constructor(private readonly deps: Deps) {}

  async execute(input: SubmitSupportTicketInput): Promise<SubmitSupportTicketResult> {
    // 1. Тикет в БД — источник истины. Сохраняется всегда, до любой доставки.
    const ticket = await this.deps.tickets.create({
      userId: input.userId,
      message: input.message,
      source: input.source,
    });

    // 2. Доставка в Telegram — best-effort. Никогда не роняет запрос: тикет уже в БД,
    //    пользователь должен увидеть «отправлено» даже если TG временно недоступен.
    const delivery = await this.deliver(ticket).catch((err): SupportDeliveryChannel => {
      console.warn('[support] telegram delivery failed:', err);
      return 'saved_only';
    });

    return { ticket, delivery };
  }

  private async deliver(ticket: SupportTicket): Promise<SupportDeliveryChannel> {
    const text = await this.formatMessage(ticket);

    // Прямой канал: явный chat_id поддержки задан в env.
    if (this.deps.supportChatId !== null && Number.isFinite(this.deps.supportChatId)) {
      const res = await this.deps.client.sendMessage({
        chatId: this.deps.supportChatId,
        text,
        parseMode: 'HTML',
        disableWebPagePreview: true,
      });
      if (res.kind === 'ok') return 'telegram_chat';
      console.warn(`[support] sendMessage to support chat failed: ${res.kind}`);
      // Падать на админ-fallback нет смысла: chat_id задан осознанно. Тикет в БД остаётся.
      return 'saved_only';
    }

    // Fallback: рассылаем уведомление всем админам через их личную TG-привязку.
    const admins = await this.deps.users.listAdmins();
    let deliveredToAny = false;
    for (const admin of admins) {
      const res = await this.deps.sendNotification.execute({
        userId: admin.id,
        text,
        parseMode: 'HTML',
        kind: 'support_ticket',
        // Алерт админ-уровня: не зависит от пользовательских pref-тогглов и дедупа.
        skipPrefsCheck: true,
        skipDedupCheck: true,
      });
      if (res.status === 'ok') deliveredToAny = true;
    }
    return deliveredToAny ? 'admin_fallback' : 'saved_only';
  }

  private async formatMessage(ticket: SupportTicket): Promise<string> {
    let who = 'Аноним (лендинг)';
    if (ticket.userId) {
      const user = await this.deps.users.getById(ticket.userId).catch(() => null);
      who = user
        ? `${escapeHtml(user.displayName)} (${escapeHtml(user.email)})`
        : `user ${ticket.userId}`;
    }
    return [
      '🆘 <b>Новое обращение в поддержку</b>',
      `Источник: ${SOURCE_LABEL[ticket.source]}`,
      `От: ${who}`,
      '',
      escapeHtml(ticket.message),
    ].join('\n');
  }
}
