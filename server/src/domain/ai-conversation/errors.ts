export class AiConversationNotFoundError extends Error {
  readonly code = 'CONVERSATION_NOT_FOUND';
  constructor() {
    super('AI conversation not found');
    this.name = 'AiConversationNotFoundError';
  }
}

export class AiConversationVersionConflictError extends Error {
  readonly code = 'CONVERSATION_VERSION_CONFLICT';
  constructor(readonly currentVersion: number) {
    super(`AI conversation version conflict; current version is ${currentVersion}`);
    this.name = 'AiConversationVersionConflictError';
  }
}

export class AiConversationValidationError extends Error {
  readonly code = 'INVALID_REQUEST';
  constructor(message: string) {
    super(message);
    this.name = 'AiConversationValidationError';
  }
}

export class AiConversationDispatcherMissingError extends Error {
  readonly code = 'AI_DISPATCHER_NOT_CONFIGURED';
  constructor() {
    super('No AI dispatcher is configured for this conversation');
    this.name = 'AiConversationDispatcherMissingError';
  }
}

export class AiConversationRunNotFoundError extends Error {
  readonly code = 'RUN_NOT_FOUND';
  constructor() {
    super('AI conversation run not found');
    this.name = 'AiConversationRunNotFoundError';
  }
}

export class AiConversationRunStateConflictError extends Error {
  readonly code = 'RUN_STATE_CONFLICT';
  constructor(readonly currentStatus: string) {
    super(`AI conversation run cannot transition from ${currentStatus}`);
    this.name = 'AiConversationRunStateConflictError';
  }
}

export class AiConversationCompletionConflictError extends Error {
  readonly code = 'RUN_COMPLETION_CONFLICT';
  constructor() {
    super('The run was already completed with another idempotency key');
    this.name = 'AiConversationCompletionConflictError';
  }
}
