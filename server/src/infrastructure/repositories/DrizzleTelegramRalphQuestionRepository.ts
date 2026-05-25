import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { telegramRalphQuestionMessages } from '../db/schema.js';
import type {
  CreateTgRalphQuestionMessageInput,
  TelegramRalphQuestionRepository,
  TgRalphQuestionMessage,
} from '../../application/telegram/TelegramRalphQuestionRepository.js';

export class DrizzleTelegramRalphQuestionRepository implements TelegramRalphQuestionRepository {
  constructor(private readonly db: Database) {}

  async upsert(input: CreateTgRalphQuestionMessageInput): Promise<void> {
    // MariaDB ON DUPLICATE KEY UPDATE — composite PK (tg_chat_id, tg_message_id).
    // На конфликте перезаписываем target — это безопаснее чем игнор (если message_id
    // переиспользовался — что не должно случаться, но всё же).
    await this.db
      .insert(telegramRalphQuestionMessages)
      .values({
        tgChatId: input.tgChatId,
        tgMessageId: input.tgMessageId,
        recipientUserId: input.recipientUserId,
        taskId: input.taskId,
        ralphQuestionId: input.ralphQuestionId,
      })
      .onDuplicateKeyUpdate({
        set: {
          recipientUserId: input.recipientUserId,
          taskId: input.taskId,
          ralphQuestionId: input.ralphQuestionId,
        },
      });
  }

  async findByMessage(
    tgChatId: number,
    tgMessageId: number,
  ): Promise<TgRalphQuestionMessage | null> {
    const rows = await this.db
      .select()
      .from(telegramRalphQuestionMessages)
      .where(
        and(
          eq(telegramRalphQuestionMessages.tgChatId, tgChatId),
          eq(telegramRalphQuestionMessages.tgMessageId, tgMessageId),
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
      ralphQuestionId: r.ralphQuestionId,
      sentAt: r.sentAt,
    };
  }
}
