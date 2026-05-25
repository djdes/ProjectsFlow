// Аудит исходящих TG-сообщений. Используется для дедупа (одинаковый kind+task в течение
// 60с — skip) и debugging.

export type OutboundStatus =
  | 'ok'
  | 'forbidden'
  | 'rate_limited'
  | 'error'
  | 'skipped_dedup'
  | 'skipped_pref_off'
  | 'skipped_not_started';

export type CreateOutboundInput = {
  readonly id: string;
  readonly userId: string;
  readonly chatId: number;
  readonly eventKind: string;
  readonly taskId: string | null;
  readonly messageId: number | null;
  readonly status: OutboundStatus;
  readonly errorText: string | null;
};

export interface TelegramOutboundRepository {
  create(input: CreateOutboundInput): Promise<void>;
  // Был ли за последние windowSeconds успешный (ok) send тому же user+kind+task?
  // Используется для дедупа — НЕ блокирует если предыдущая попытка завершилась с ошибкой.
  existsRecent(
    userId: string,
    eventKind: string,
    taskId: string | null,
    windowSeconds: number,
  ): Promise<boolean>;
}
