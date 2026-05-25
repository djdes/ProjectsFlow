// Маппинг отправленных TG-сообщений с ralph-question на question_id и task_id.
// Заполняется при успешной отправке через SendAgentTelegramNotification, читается
// webhook-handler'ом при получении reply'я от юзера. См. spec
// C:/www/ralph/prompts/telegram-reply-to-ralph-answer.md.

export type CreateTgRalphQuestionMessageInput = {
  readonly tgChatId: number;
  readonly tgMessageId: number;
  readonly recipientUserId: string;
  readonly taskId: string;
  readonly ralphQuestionId: string;
};

export type TgRalphQuestionMessage = {
  readonly tgChatId: number;
  readonly tgMessageId: number;
  readonly recipientUserId: string;
  readonly taskId: string;
  readonly ralphQuestionId: string;
  readonly sentAt: Date;
};

export interface TelegramRalphQuestionRepository {
  // Upsert (PK = chat+message_id). Если сообщение пересохранили (вряд ли — TG не повторяет
  // message_id в чате) — обновляем привязку. На практике конфликт = bug, но не падаем.
  upsert(input: CreateTgRalphQuestionMessageInput): Promise<void>;
  // Найти маппинг по reply_to ссылке из webhook'а. NULL — reply не на наш ralph-question.
  findByMessage(tgChatId: number, tgMessageId: number): Promise<TgRalphQuestionMessage | null>;
}
