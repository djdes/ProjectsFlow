import type {
  SupportTicket,
  SupportTicketSource,
  SupportTicketStatus,
} from '../../domain/help/SupportTicket.js';

export type NewSupportTicketInput = {
  // null — анонимная отправка с лендинга.
  readonly userId: string | null;
  readonly message: string;
  readonly source: SupportTicketSource;
};

// Тикет + данные отправителя (для админ-списка). submitter* = null для анонимных (landing).
export type SupportTicketWithSubmitter = SupportTicket & {
  readonly submitterDisplayName: string | null;
  readonly submitterEmail: string | null;
};

export interface SupportTicketRepository {
  create(input: NewSupportTicketInput): Promise<SupportTicket>;
  // Для админ-раздела: все тикеты (open сверху, затем по дате убыв.), с данными отправителя.
  listAll(opts: { limit: number }): Promise<SupportTicketWithSubmitter[]>;
  setStatus(id: string, status: SupportTicketStatus): Promise<void>;
}
