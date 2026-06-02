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

// Делегирование inbox-задач (см. db/039, spec inbox-checkbox-and-delegation).

export class SelfDelegationError extends Error {
  readonly status = 400;
  constructor() {
    super('Нельзя делегировать задачу самому себе');
    this.name = 'SelfDelegationError';
  }
}

export class DelegateNotInSharedMembersError extends Error {
  readonly status = 403;
  constructor() {
    super('Этому пользователю нельзя делегировать (он не в общих проектах)');
    this.name = 'DelegateNotInSharedMembersError';
  }
}

// Делегирование задачи именованного проекта: делегат должен быть участником-редактором
// этого проекта (editor+), иначе примет задачу, но получит 403 на move/выполнение
// (см. requireTaskModifyAccess: non-inbox ветка = обычный requireProjectAccess('move_task')).
export class DelegateNotProjectMemberError extends Error {
  readonly status = 403;
  constructor() {
    super('Делегировать можно только участнику-редактору этого проекта');
    this.name = 'DelegateNotProjectMemberError';
  }
}

export class DelegationNotFoundError extends Error {
  readonly status = 404;
  constructor(public readonly delegationId: string) {
    super(`Delegation not found: ${delegationId}`);
    this.name = 'DelegationNotFoundError';
  }
}

export class DelegationWrongStateError extends Error {
  readonly status = 409;
  constructor(public readonly got: string, public readonly expected: string) {
    super(`Ожидался статус ${expected}, текущий: ${got}`);
    this.name = 'DelegationWrongStateError';
  }
}

export class NotDelegateError extends Error {
  readonly status = 403;
  constructor() {
    super('Только делегат может выполнять это действие');
    this.name = 'NotDelegateError';
  }
}

export class NotCreatorError extends Error {
  readonly status = 403;
  constructor() {
    super('Только создатель задачи может выполнять это действие');
    this.name = 'NotCreatorError';
  }
}

export class NotInboxTaskError extends Error {
  readonly status = 400;
  constructor() {
    super('Это действие доступно только для inbox-задач');
    this.name = 'NotInboxTaskError';
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

export class AlreadyDelegatedError extends Error {
  readonly status = 409;
  constructor() {
    super('Задача уже делегирована');
    this.name = 'AlreadyDelegatedError';
  }
}
