export type TelegramTaskOrigin = {
  readonly taskId: string;
  readonly projectId: string;
  readonly chatId: number;
  readonly messageId: number | null;
  readonly requestedAt: Date | null;
  readonly reportedAt?: Date | null;
};

// Durable destination and delivery queue. The destination comes exclusively from
// Telegram intake; an agent cannot choose or replace the chat when reporting results.
export interface TelegramTaskOriginRepository {
  recoverCompleted?(now: Date): Promise<void>;
  attach(origin: Omit<TelegramTaskOrigin, 'requestedAt'>): Promise<void>;
  getByTask(taskId: string): Promise<TelegramTaskOrigin | null>;
  requestResult(taskId: string, now: Date): Promise<void>;
  listDue(now: Date, limit: number): Promise<TelegramTaskOrigin[]>;
  claim(taskId: string, token: string, now: Date, until: Date): Promise<boolean>;
  finish(taskId: string, token: string, now: Date): Promise<void>;
  retry(taskId: string, token: string, at: Date): Promise<void>;
}
