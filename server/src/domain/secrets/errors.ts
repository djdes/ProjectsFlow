export class SecretNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`Secret with key "${key}" not found`);
    this.name = 'SecretNotFoundError';
  }
}

export class SecretKeyInvalidError extends Error {
  constructor(public readonly key: string) {
    super(`Invalid secret key format: "${key}"`);
    this.name = 'SecretKeyInvalidError';
  }
}
