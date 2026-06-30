import { desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import type { SupportTicket, SupportTicketStatus } from '../../domain/help/SupportTicket.js';
import type {
  NewSupportTicketInput,
  SupportTicketRepository,
  SupportTicketWithSubmitter,
} from '../../application/help/SupportTicketRepository.js';
import { idGenerator } from '../id/idGenerator.js';
import { supportTickets, users, type SupportTicketRow } from '../db/schema.js';

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

  async listAll(opts: { limit: number }): Promise<SupportTicketWithSubmitter[]> {
    // LEFT JOIN users — submitter может быть null (анонимная отправка с лендинга).
    // Сортировка: открытые сверху, затем по дате убыв.
    const rows = await this.db
      .select({
        id: supportTickets.id,
        userId: supportTickets.userId,
        message: supportTickets.message,
        source: supportTickets.source,
        status: supportTickets.status,
        createdAt: supportTickets.createdAt,
        submitterDisplayName: users.displayName,
        submitterEmail: users.email,
      })
      .from(supportTickets)
      .leftJoin(users, eq(users.id, supportTickets.userId))
      .orderBy(sql`${supportTickets.status} = 'open' DESC`, desc(supportTickets.createdAt))
      .limit(opts.limit);
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId ?? null,
      message: r.message,
      source: r.source,
      status: r.status,
      createdAt: r.createdAt,
      submitterDisplayName: r.submitterDisplayName ?? null,
      submitterEmail: r.submitterEmail ?? null,
    }));
  }

  async setStatus(id: string, status: SupportTicketStatus): Promise<void> {
    await this.db.update(supportTickets).set({ status }).where(eq(supportTickets.id, id));
  }
}
