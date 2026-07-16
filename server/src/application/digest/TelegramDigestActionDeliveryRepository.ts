export type TelegramDigestMessageKind = 'rich' | 'html';

export type TelegramDigestActionDelivery = {
  readonly token: string;
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

  updateMessage(input: {
    readonly chatId: number;
    readonly messageId: number;
    readonly messageHtml: string;
  }): Promise<void>;
}
