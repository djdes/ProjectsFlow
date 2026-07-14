// Маппинг task-сообщений бота (карточка-подтверждение конструктора, сообщение
// назначения ответственного, карточка из /tasks) → task_id. Обобщает telegram_ralph_question_messages:
// reply на любое такое сообщение создаёт обычный комментарий к задаче. См. db/049.

export type CreateTelegramTaskMessageInput = {
  readonly tgChatId: number;
  readonly tgMessageId: number;
  readonly recipientUserId: string;
  readonly taskId: string;
  readonly projectId: string;
};

export type TelegramTaskMessage = {
  readonly tgChatId: number;
  readonly tgMessageId: number;
  readonly recipientUserId: string;
  readonly taskId: string;
  readonly projectId: string;
  readonly sentAt: Date;
};

export interface TelegramTaskMessageRepository {
  // Upsert (PK = chat+message_id). На конфликте перезаписываем привязку.
  upsert(input: CreateTelegramTaskMessageInput): Promise<void>;
  // Найти привязку по reply_to из webhook'а. NULL — reply не на task-сообщение бота.
  findByMessage(tgChatId: number, tgMessageId: number): Promise<TelegramTaskMessage | null>;
}
