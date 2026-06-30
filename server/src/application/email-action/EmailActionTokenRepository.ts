// Порт токенов действий из писем-сводок (one-click «Завершить»/«Комментировать»).
// Токен — случайный opaque (как инвайт), валидируется по БД. См. план gleaming-munching-locket.
export type EmailActionType = 'complete' | 'comment';

export type EmailActionToken = {
  readonly id: string;
  readonly token: string;
  readonly action: EmailActionType;
  readonly taskId: string;
  readonly projectId: string;
  // Получатель сводки = актор действия (от его имени выполняем complete/comment).
  readonly userId: string;
  readonly usedAt: Date | null;
  readonly expiresAt: Date;
};

export type NewEmailActionToken = {
  readonly id: string;
  readonly token: string;
  readonly action: EmailActionType;
  readonly taskId: string;
  readonly projectId: string;
  readonly userId: string;
  readonly expiresAt: Date;
};

export interface EmailActionTokenRepository {
  create(input: NewEmailActionToken): Promise<void>;
  findByToken(token: string): Promise<EmailActionToken | null>;
  // Пометить одноразовый токен использованным (для action='complete').
  markUsed(id: string, usedAt: Date): Promise<void>;
}
