import { eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { emailActionTokens, type EmailActionTokenRow } from '../db/schema.js';
import type {
  EmailActionToken,
  EmailActionTokenRepository,
  NewEmailActionToken,
} from '../../application/email-action/EmailActionTokenRepository.js';

function toToken(r: EmailActionTokenRow): EmailActionToken {
  return {
    id: r.id,
    token: r.token,
    action: r.action,
    taskId: r.taskId,
    projectId: r.projectId,
    userId: r.userId,
    usedAt: r.usedAt ?? null,
    expiresAt: r.expiresAt,
  };
}

export class DrizzleEmailActionTokenRepository implements EmailActionTokenRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewEmailActionToken): Promise<void> {
    await this.db.insert(emailActionTokens).values({
      id: input.id,
      token: input.token,
      action: input.action,
      taskId: input.taskId,
      projectId: input.projectId,
      userId: input.userId,
      expiresAt: input.expiresAt,
    });
  }

  async findByToken(token: string): Promise<EmailActionToken | null> {
    const rows = await this.db
      .select()
      .from(emailActionTokens)
      .where(eq(emailActionTokens.token, token))
      .limit(1);
    const row = rows[0];
    return row ? toToken(row) : null;
  }

  async markUsed(id: string, usedAt: Date): Promise<void> {
    await this.db.update(emailActionTokens).set({ usedAt }).where(eq(emailActionTokens.id, id));
  }
}
