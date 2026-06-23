// Доменные ошибки чата пространства. Мапятся в HTTP-статусы в
// presentation/middleware/errorHandler.ts.

export class ChatMessageNotFoundError extends Error {
  constructor(public readonly messageId: string) {
    super(`Chat message not found: ${messageId}`);
    this.name = 'ChatMessageNotFoundError';
  }
}

// Редактировать может только автор; удалять — автор или owner пространства.
export class NotMessageAuthorError extends Error {
  constructor() {
    super('Only the author can edit this message');
    this.name = 'NotMessageAuthorError';
  }
}

export class CannotDeleteMessageError extends Error {
  constructor() {
    super('Only the author or a workspace owner can delete this message');
    this.name = 'CannotDeleteMessageError';
  }
}

// Уже удалённое сообщение нельзя править/реагировать.
export class MessageDeletedError extends Error {
  constructor() {
    super('Message is deleted');
    this.name = 'MessageDeletedError';
  }
}

// Пустое сообщение без вложений недопустимо.
export class EmptyMessageError extends Error {
  constructor() {
    super('Message must have text or an attachment');
    this.name = 'EmptyMessageError';
  }
}

export class ChatAttachmentNotFoundError extends Error {
  constructor(public readonly attachmentId: string) {
    super(`Chat attachment not found: ${attachmentId}`);
    this.name = 'ChatAttachmentNotFoundError';
  }
}

export class ChatAttachmentTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`Attachment exceeds limit of ${maxBytes} bytes`);
    this.name = 'ChatAttachmentTooLargeError';
  }
}
