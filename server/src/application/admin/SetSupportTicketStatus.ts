import type { SupportTicketStatus } from '../../domain/help/SupportTicket.js';
import type { SupportTicketRepository } from '../help/SupportTicketRepository.js';

// Сменить статус обращения (open ↔ closed) из админ-раздела.
export class SetSupportTicketStatus {
  constructor(private readonly tickets: SupportTicketRepository) {}

  execute(id: string, status: SupportTicketStatus): Promise<void> {
    return this.tickets.setStatus(id, status);
  }
}
