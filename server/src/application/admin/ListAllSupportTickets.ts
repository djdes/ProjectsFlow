import type {
  SupportTicketRepository,
  SupportTicketWithSubmitter,
} from '../help/SupportTicketRepository.js';

const DEFAULT_LIMIT = 200;

// Список обращений в поддержку для админ-раздела (open сверху, затем по дате убыв.).
export class ListAllSupportTickets {
  constructor(private readonly tickets: SupportTicketRepository) {}

  execute(): Promise<SupportTicketWithSubmitter[]> {
    return this.tickets.listAll({ limit: DEFAULT_LIMIT });
  }
}
