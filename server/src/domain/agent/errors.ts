export class AgentTokenNotFoundError extends Error {
  constructor() {
    super('Agent token not found');
    this.name = 'AgentTokenNotFoundError';
  }
}

export class AgentTokenInvalidError extends Error {
  constructor() {
    super('Agent token invalid or revoked');
    this.name = 'AgentTokenInvalidError';
  }
}

export class AgentTokenNameEmptyError extends Error {
  constructor() {
    super('Token name required');
    this.name = 'AgentTokenNameEmptyError';
  }
}

// Device flow errors

export class AgentDeviceCodeNotFoundError extends Error {
  constructor() {
    super('Device code not found');
    this.name = 'AgentDeviceCodeNotFoundError';
  }
}

export class AgentDeviceCodePendingError extends Error {
  constructor() {
    super('Device code still pending approval');
    this.name = 'AgentDeviceCodePendingError';
  }
}

export class AgentDeviceCodeExpiredError extends Error {
  constructor() {
    super('Device code has expired');
    this.name = 'AgentDeviceCodeExpiredError';
  }
}

export class AgentDeviceCodeConsumedError extends Error {
  constructor() {
    super('Device code has already been consumed');
    this.name = 'AgentDeviceCodeConsumedError';
  }
}

export class AgentDeviceCodeDeniedError extends Error {
  constructor() {
    super('Device code was denied by user');
    this.name = 'AgentDeviceCodeDeniedError';
  }
}

export class AgentDeviceCodeAlreadyApprovedError extends Error {
  constructor() {
    super('Device code already approved');
    this.name = 'AgentDeviceCodeAlreadyApprovedError';
  }
}

export class AgentJobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Agent job ${jobId} not found`);
    this.name = 'AgentJobNotFoundError';
  }
}

export class AgentJobNotCancellableError extends Error {
  constructor(jobId: string, currentStatus: string) {
    super(`Agent job ${jobId} cannot be cancelled — current status: ${currentStatus}`);
    this.name = 'AgentJobNotCancellableError';
  }
}

export class TaskAlreadyHasActiveAgentJobError extends Error {
  constructor(taskId: string) {
    super(`Task ${taskId} already has an active agent job`);
    this.name = 'TaskAlreadyHasActiveAgentJobError';
  }
}

export class TaskMissingDescriptionError extends Error {
  constructor(taskId: string) {
    super(`Task ${taskId} has no description — nothing to delegate to agent`);
    this.name = 'TaskMissingDescriptionError';
  }
}
