export class AiActionBatchNotFoundError extends Error {
  readonly code = 'BATCH_NOT_FOUND';
  constructor() {
    super('AI action batch not found');
    this.name = 'AiActionBatchNotFoundError';
  }
}

export class AiActionBatchStateConflictError extends Error {
  readonly code = 'BATCH_STATE_CONFLICT';
  constructor(readonly currentStatus: string) {
    super(`AI action batch cannot transition from ${currentStatus}`);
    this.name = 'AiActionBatchStateConflictError';
  }
}

export class AiActionBatchValidationError extends Error {
  readonly code = 'INVALID_REQUEST';
  constructor(message: string) {
    super(message);
    this.name = 'AiActionBatchValidationError';
  }
}
