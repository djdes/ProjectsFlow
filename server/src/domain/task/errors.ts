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

export class AssigneeNotProjectMemberError extends Error {
  readonly status = 403;
  constructor() {
    super('Ответственным можно назначить только участника проекта');
    this.name = 'AssigneeNotProjectMemberError';
  }
}

export class AssigneeNotSharedMemberError extends Error {
  readonly status = 403;
  constructor() {
    super('Ответственным личной задачи можно назначить только общего участника');
    this.name = 'AssigneeNotSharedMemberError';
  }
}

export class TaskVersionNotFoundError extends Error {
  readonly status = 404;
  constructor(public readonly versionId: string) {
    super(`Task version not found: ${versionId}`);
    this.name = 'TaskVersionNotFoundError';
  }
}

// Версия старше лимита бесплатного тарифа (7 дней) — нужен Прайм/ВИП.
export class TaskVersionLockedError extends Error {
  readonly status = 402;
  constructor() {
    super('Эта версия старше 7 дней — доступна на тарифе Прайм или ВИП');
    this.name = 'TaskVersionLockedError';
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

export class TaskCommentNotFoundError extends Error {
  constructor(public readonly commentId: string) {
    super(`Task comment not found: ${commentId}`);
    this.name = 'TaskCommentNotFoundError';
  }
}

export class TaskCommentBodyEmptyError extends Error {
  constructor() {
    super('Comment body must be non-empty');
    this.name = 'TaskCommentBodyEmptyError';
  }
}

export class InboxOwnerRequiredError extends Error {
  readonly status = 403;
  constructor() {
    super('Перенести личную задачу в проект может только владелец личной доски');
    this.name = 'InboxOwnerRequiredError';
  }
}

export class TargetProjectNotFoundError extends Error {
  readonly status = 404;
  constructor(public readonly projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = 'TargetProjectNotFoundError';
  }
}

export class TargetProjectIsInboxError extends Error {
  readonly status = 400;
  constructor() {
    super('Целевой проект — это inbox; такого переноса не делаем');
    this.name = 'TargetProjectIsInboxError';
  }
}
