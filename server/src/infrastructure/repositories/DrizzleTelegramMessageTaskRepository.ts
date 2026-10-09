import { and, asc, eq, lt, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { telegramMessageTasks } from '../db/schema.js';
import type {
  TelegramMessageTask,
  TelegramMessageTaskRepository,
} from '../../application/telegram/TelegramMessageTaskRepository.js';

export class DrizzleTelegramMessageTaskRepository implements TelegramMessageTaskRepository {
  constructor(private readonly db: Database) {}

  async attach(input: {
    readonly chatId: number;
    readonly messageId: number;
    readonly tasks: readonly TelegramMessageTask[];
  }): Promise<void> {
    if (input.tasks.length === 0) return;
    await this.db
      .insert(telegramMessageTasks)
      .values(
        input.tasks.map((task, position) => ({
          tgChatId: input.chatId,
          tgMessageId: input.messageId,
          taskId: task.taskId,
          projectId: task.projectId,
          position,
        })),
      )
      // Та же задача в том же сообщении — уже записана; порядок первой записи остаётся.
      .onDuplicateKeyUpdate({ set: { taskId: sql`task_id` } });
  }

  async listByMessage(chatId: number, messageId: number): Promise<TelegramMessageTask[]> {
    const rows = await this.db
      .select({ taskId: telegramMessageTasks.taskId, projectId: telegramMessageTasks.projectId })
      .from(telegramMessageTasks)
      .where(
        and(
          eq(telegramMessageTasks.tgChatId, chatId),
          eq(telegramMessageTasks.tgMessageId, messageId),
        ),
      )
      .orderBy(asc(telegramMessageTasks.position));
    return rows;
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const result = await this.db
      .delete(telegramMessageTasks)
      .where(lt(telegramMessageTasks.createdAt, cutoff));
    return (result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0;
  }
}
