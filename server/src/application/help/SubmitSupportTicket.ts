import type { SupportTicket, SupportTicketSource } from '../../domain/help/SupportTicket.js';
import type { SupportTicketRepository } from './SupportTicketRepository.js';
import type { UserRepository } from '../user/UserRepository.js';
import type { NotificationRepository } from '../notifications/NotificationRepository.js';

// Куда ушла доставка тикета. admins_notified — создано in-app уведомление админам (рут видит
// в разделе «Администрирование»). saved_only — тикет в БД есть, но админов нет / уведомление
// не создалось. Для логов/телеметрии.
export type SupportDeliveryChannel = 'admins_notified' | 'saved_only';

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
  // PublishingNotificationRepository: create() сохраняет + пушит в SSE (бейдж у рута live).
  readonly notifications: NotificationRepository;
  readonly idGen: () => string;
};

// Превью сообщения для уведомления (первые ~140 символов, схлопнутые пробелы).
function excerpt(s: string, max = 140): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export class SubmitSupportTicket {
  constructor(private readonly deps: Deps) {}

  async execute(input: SubmitSupportTicketInput): Promise<SubmitSupportTicketResult> {
    // 1. Тикет в БД — источник истины. Сохраняется всегда, до любой доставки.
    const ticket = await this.deps.tickets.create({
      userId: input.userId,
      message: input.message,
      source: input.source,
    });

    // 2. Доставка = in-app уведомление всем админам (рут видит в «Администрировании»).
    //    Best-effort: тикет уже в БД, сбой уведомления не роняет запрос.
    const delivery = await this.notifyAdmins(ticket).catch((err): SupportDeliveryChannel => {
      console.warn('[support] admin notify failed:', err);
      return 'saved_only';
    });

    return { ticket, delivery };
  }

  private async notifyAdmins(ticket: SupportTicket): Promise<SupportDeliveryChannel> {
    const submitterDisplayName = ticket.userId
      ? ((await this.deps.users.getById(ticket.userId).catch(() => null))?.displayName ?? null)
      : null;
    const messageExcerpt = excerpt(ticket.message);

    const admins = await this.deps.users.listAdmins();
    if (admins.length === 0) return 'saved_only';

    for (const admin of admins) {
      await this.deps.notifications.create({
        id: this.deps.idGen(),
        userId: admin.id,
        payload: {
          type: 'support_ticket',
          ticketId: ticket.id,
          source: ticket.source,
          messageExcerpt,
          submitterUserId: ticket.userId,
          submitterDisplayName,
        },
      });
    }
    return 'admins_notified';
  }
}
