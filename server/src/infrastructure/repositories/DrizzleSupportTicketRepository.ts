import { eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import type { SupportTicket } from '../../domain/help/SupportTicket.js';
import type {
  NewSupportTicketInput,
  SupportTicketRepository,
} from '../../application/help/SupportTicketRepository.js';
import { idGenerator } from '../id/idGenerator.js';
import { supportTickets, type SupportTicketRow } from '../db/schema.js';

function rowToTicket(row: SupportTicketRow): SupportTicket {
  return {
    id: row.id,
    userId: row.userId ?? null,
    message: row.message,
    source: row.source,
    status: row.status,
    createdAt: row.createdAt,
  };
}

export class DrizzleSupportTicketRepository implements SupportTicketRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewSupportTicketInput): Promise<SupportTicket> {
    const id = idGenerator();
    await this.db.insert(supportTickets).values({
      id,
      userId: input.userId,
      message: input.message,
      source: input.source,
    });
    const rows = await this.db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error(`support_tickets row ${id} disappeared after insert`);
    return rowToTicket(row);
  }
}
