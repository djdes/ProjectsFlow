import type { SupportTicket, SupportTicketSource } from '../../domain/help/SupportTicket.js';

export type NewSupportTicketInput = {
  // null — анонимная отправка с лендинга.
  readonly userId: string | null;
  readonly message: string;
  readonly source: SupportTicketSource;
};

export interface SupportTicketRepository {
  create(input: NewSupportTicketInput): Promise<SupportTicket>;
}
