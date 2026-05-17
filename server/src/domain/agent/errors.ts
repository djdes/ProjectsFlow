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
