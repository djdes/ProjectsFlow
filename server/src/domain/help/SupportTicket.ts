// Обращение в поддержку из чат-виджета. Источник 'app' (залогиненный пользователь в
// приложении) или 'landing' (анонимная отправка с лендинга — userId === null).

export type SupportTicketSource = 'app' | 'landing';

export const SUPPORT_TICKET_SOURCES: readonly SupportTicketSource[] = ['app', 'landing'];

export type SupportTicketStatus = 'open' | 'closed';

// Жёсткий потолок длины сообщения (совпадает с UI-счётчиком «x/2000»).
export const SUPPORT_MESSAGE_MAX_LENGTH = 2000;

export type SupportTicket = {
  readonly id: string;
  // null — анонимная отправка с лендинга (пользователь не залогинен).
  readonly userId: string | null;
  readonly message: string;
  readonly source: SupportTicketSource;
  readonly status: SupportTicketStatus;
  readonly createdAt: Date;
};
