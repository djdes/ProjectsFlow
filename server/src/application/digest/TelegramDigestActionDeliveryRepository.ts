export type TelegramDigestMessageKind = 'rich' | 'html';

export type TelegramDigestActionDelivery = {
  readonly token: string;
  readonly taskId: string;
  readonly chatId: number;
  readonly messageId: number;
  readonly messageHtml: string;
  readonly messageKind: TelegramDigestMessageKind;
};

export interface TelegramDigestActionDeliveryRepository {
  attach(input: {
    readonly tokens: readonly string[];
    readonly chatId: number;
    readonly messageId: number;
    readonly messageHtml: string;
    readonly messageKind: TelegramDigestMessageKind;
  }): Promise<void>;

  findByToken(token: string): Promise<TelegramDigestActionDelivery | null>;

  listByMessage(
    chatId: number,
    messageId: number,
  ): Promise<TelegramDigestActionDelivery[]>;

  updateMessage(input: {
    readonly chatId: number;
    readonly messageId: number;
    readonly messageHtml: string;
  }): Promise<void>;
}
