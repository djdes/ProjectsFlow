import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { telegramOutboundMessages } from '../db/schema.js';
import type {
  CreateOutboundInput,
  TelegramOutboundRepository,
} from '../../application/telegram/TelegramOutboundRepository.js';

export class DrizzleTelegramOutboundRepository implements TelegramOutboundRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateOutboundInput): Promise<void> {
    await this.db.insert(telegramOutboundMessages).values({
      id: input.id,
      userId: input.userId,
      chatId: input.chatId,
      eventKind: input.eventKind,
      taskId: input.taskId,
      messageId: input.messageId,
      status: input.status,
      errorText: input.errorText,
    });
  }

  async existsRecent(
    userId: string,
    eventKind: string,
    taskId: string | null,
    windowSeconds: number,
  ): Promise<boolean> {
    const since = new Date(Date.now() - windowSeconds * 1000);
    const conditions = [
      eq(telegramOutboundMessages.userId, userId),
      eq(telegramOutboundMessages.eventKind, eventKind),
      eq(telegramOutboundMessages.status, 'ok'),
      gte(telegramOutboundMessages.sentAt, since),
      taskId
        ? eq(telegramOutboundMessages.taskId, taskId)
        : isNull(telegramOutboundMessages.taskId),
    ];
    const rows = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(telegramOutboundMessages)
      .where(and(...conditions));
    return Number(rows[0]?.count ?? 0) > 0;
  }
}
