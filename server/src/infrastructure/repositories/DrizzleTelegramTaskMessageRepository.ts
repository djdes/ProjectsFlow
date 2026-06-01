import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { telegramTaskMessages } from '../db/schema.js';
import type {
  CreateTelegramTaskMessageInput,
  TelegramTaskMessage,
  TelegramTaskMessageRepository,
} from '../../application/telegram/TelegramTaskMessageRepository.js';

export class DrizzleTelegramTaskMessageRepository implements TelegramTaskMessageRepository {
  constructor(private readonly db: Database) {}

  async upsert(input: CreateTelegramTaskMessageInput): Promise<void> {
    await this.db
      .insert(telegramTaskMessages)
      .values({
        tgChatId: input.tgChatId,
        tgMessageId: input.tgMessageId,
        recipientUserId: input.recipientUserId,
        taskId: input.taskId,
        projectId: input.projectId,
      })
      .onDuplicateKeyUpdate({
        set: {
          recipientUserId: input.recipientUserId,
          taskId: input.taskId,
          projectId: input.projectId,
        },
      });
  }

  async findByMessage(
    tgChatId: number,
    tgMessageId: number,
  ): Promise<TelegramTaskMessage | null> {
    const rows = await this.db
      .select()
      .from(telegramTaskMessages)
      .where(
        and(
          eq(telegramTaskMessages.tgChatId, tgChatId),
          eq(telegramTaskMessages.tgMessageId, tgMessageId),
        ),
      )
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      tgChatId: Number(r.tgChatId),
      tgMessageId: Number(r.tgMessageId),
      recipientUserId: r.recipientUserId,
      taskId: r.taskId,
      projectId: r.projectId,
      sentAt: r.sentAt,
    };
  }
}
