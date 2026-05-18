export class TaskNotFoundError extends Error {
  constructor(public readonly taskId: string) {
    super(`Task not found: ${taskId}`);
    this.name = 'TaskNotFoundError';
  }
}

export class TaskDescriptionEmptyError extends Error {
  constructor() {
    super('Task description must be non-empty');
    this.name = 'TaskDescriptionEmptyError';
  }
}

export class TaskCommitNotFoundError extends Error {
  constructor(public readonly sha: string) {
    super(`Commit not linked to task: ${sha}`);
    this.name = 'TaskCommitNotFoundError';
  }
}

export class TaskAttachmentNotFoundError extends Error {
  constructor(public readonly attachmentId: string) {
    super(`Task attachment not found: ${attachmentId}`);
    this.name = 'TaskAttachmentNotFoundError';
  }
}

export class TaskAttachmentTooLargeError extends Error {
  constructor(public readonly sizeBytes: number, public readonly maxBytes: number) {
    super(`Attachment too large: ${sizeBytes} > ${maxBytes}`);
    this.name = 'TaskAttachmentTooLargeError';
  }
}

export class TaskAttachmentTypeNotAllowedError extends Error {
  constructor(public readonly mimeType: string) {
    super(`Attachment MIME type not allowed: ${mimeType}`);
    this.name = 'TaskAttachmentTypeNotAllowedError';
  }
}
