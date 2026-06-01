// Порт журнала доставки уведомлений по комментарию. Единственный писатель — оркестратор
// DispatchCommentNotifications; читатель — use-case GetCommentNotifications (меню ⋮).

export type CommentNotificationChannel = 'email' | 'telegram';
export type CommentNotificationStatus = 'sent' | 'skipped' | 'failed';

// Строка для записи (insert). id генерит caller через idGen.
export type CommentNotificationRecord = {
  readonly id: string;
  readonly commentId: string;
  readonly recipientUserId: string;
  readonly channel: CommentNotificationChannel;
  readonly status: CommentNotificationStatus;
  // pref_off | not_linked | no_email | dedup | rate_limited | forbidden | <error>. null для 'sent'.
  readonly reason: string | null;
};

// Строка для чтения — с присоединёнными user-данными для UI.
export type CommentNotificationWithUser = {
  readonly recipientUserId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly channel: CommentNotificationChannel;
  readonly status: CommentNotificationStatus;
  readonly reason: string | null;
  readonly createdAt: Date;
};

export interface CommentNotificationLogRepository {
  // Пакетная запись исходов доставки. Idempotent по (comment_id, recipient, channel) —
  // повторный dispatch перезапишет (UPSERT). Пустой массив — no-op.
  recordMany(rows: readonly CommentNotificationRecord[]): Promise<void>;
  // Журнал по комментарию, с user-данными, отсортирован по получателю/каналу для UI.
  listByComment(commentId: string): Promise<CommentNotificationWithUser[]>;
}
