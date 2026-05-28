export class AgentTokenNotFoundError extends Error {
  constructor() {
    super('Agent token not found');
    this.name = 'AgentTokenNotFoundError';
  }
}

// requestTarget не соответствует gitRepoUrl (или подделан/устарел).
export class RequestTargetStaleError extends Error {
  constructor() {
    super('requestTarget does not match gitRepoUrl');
    this.name = 'RequestTargetStaleError';
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

