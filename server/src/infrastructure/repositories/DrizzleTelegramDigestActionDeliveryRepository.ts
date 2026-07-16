import { and, asc, eq } from 'drizzle-orm';
import type {
  TelegramDigestActionDelivery,
  TelegramDigestActionDeliveryRepository,
} from '../../application/digest/TelegramDigestActionDeliveryRepository.js';
import type { Database } from '../db/index.js';
import {
  emailActionTokens,
  telegramDigestActionDeliveries,
} from '../db/schema.js';

type JoinedDelivery = {
  token: string;
  taskId: string;
  tgChatId: number;
  tgMessageId: number;
  messageHtml: string;
  messageKind: 'rich' | 'html';
};

function toDelivery(row: JoinedDelivery): TelegramDigestActionDelivery {
  return {
    token: row.token,
    taskId: row.taskId,
    chatId: row.tgChatId,
    messageId: row.tgMessageId,
    messageHtml: row.messageHtml,
    messageKind: row.messageKind,
  };
}

export class DrizzleTelegramDigestActionDeliveryRepository
  implements TelegramDigestActionDeliveryRepository
{
  constructor(private readonly db: Database) {}

  async attach(input: {
    readonly tokens: readonly string[];
    readonly chatId: number;
    readonly messageId: number;
    readonly messageHtml: string;
    readonly messageKind: 'rich' | 'html';
  }): Promise<void> {
    const tokens = [...new Set(input.tokens)];
    if (tokens.length === 0) return;
    await this.db
      .insert(telegramDigestActionDeliveries)
      .values(
        tokens.map((token) => ({
          token,
          tgChatId: input.chatId,
          tgMessageId: input.messageId,
          messageHtml: input.messageHtml,
          messageKind: input.messageKind,
        })),
      )
      .onDuplicateKeyUpdate({
        set: {
          tgChatId: input.chatId,
          tgMessageId: input.messageId,
          messageHtml: input.messageHtml,
          messageKind: input.messageKind,
        },
      });
  }

  async findByToken(token: string): Promise<TelegramDigestActionDelivery | null> {
    const [row] = await this.db
      .select({
        token: telegramDigestActionDeliveries.token,
        taskId: emailActionTokens.taskId,
        tgChatId: telegramDigestActionDeliveries.tgChatId,
        tgMessageId: telegramDigestActionDeliveries.tgMessageId,
        messageHtml: telegramDigestActionDeliveries.messageHtml,
        messageKind: telegramDigestActionDeliveries.messageKind,
      })
      .from(telegramDigestActionDeliveries)
      .innerJoin(
        emailActionTokens,
        eq(emailActionTokens.token, telegramDigestActionDeliveries.token),
      )
      .where(eq(telegramDigestActionDeliveries.token, token))
      .limit(1);
    return row ? toDelivery(row) : null;
  }

  async listByMessage(
    chatId: number,
    messageId: number,
  ): Promise<TelegramDigestActionDelivery[]> {
    const rows = await this.db
      .select({
        token: telegramDigestActionDeliveries.token,
        taskId: emailActionTokens.taskId,
        tgChatId: telegramDigestActionDeliveries.tgChatId,
        tgMessageId: telegramDigestActionDeliveries.tgMessageId,
        messageHtml: telegramDigestActionDeliveries.messageHtml,
        messageKind: telegramDigestActionDeliveries.messageKind,
      })
      .from(telegramDigestActionDeliveries)
      .innerJoin(
        emailActionTokens,
        eq(emailActionTokens.token, telegramDigestActionDeliveries.token),
      )
      .where(
        and(
          eq(telegramDigestActionDeliveries.tgChatId, chatId),
          eq(telegramDigestActionDeliveries.tgMessageId, messageId),
        ),
      )
      .orderBy(
        asc(telegramDigestActionDeliveries.createdAt),
        asc(telegramDigestActionDeliveries.token),
      );
    return rows.map(toDelivery);
  }

  async updateMessage(input: {
    readonly chatId: number;
    readonly messageId: number;
    readonly messageHtml: string;
  }): Promise<void> {
    await this.db
      .update(telegramDigestActionDeliveries)
      .set({ messageHtml: input.messageHtml })
      .where(
        and(
          eq(telegramDigestActionDeliveries.tgChatId, input.chatId),
          eq(telegramDigestActionDeliveries.tgMessageId, input.messageId),
        ),
      );
  }
}
