export class MagicTokenInvalidError extends Error {
  constructor() {
    super('Magic token is invalid');
    this.name = 'MagicTokenInvalidError';
  }
}

export class MagicTokenExpiredError extends Error {
  constructor() {
    super('Magic token has expired');
    this.name = 'MagicTokenExpiredError';
  }
}

export class MagicTokenConsumedError extends Error {
  constructor() {
    super('Magic token has already been used');
    this.name = 'MagicTokenConsumedError';
  }
}

export class MagicLinkRateLimitedError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super('Too many magic link requests for this email');
    this.name = 'MagicLinkRateLimitedError';
  }
}
