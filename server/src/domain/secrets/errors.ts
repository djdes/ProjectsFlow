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

export class SecretsVaultDisabledError extends Error {
  constructor() {
    super('Secrets vault is not configured (set SECRETS_MASTER_KEY)');
    this.name = 'SecretsVaultDisabledError';
  }
}

export class SecretCipherCorruptedError extends Error {
  constructor() {
    super('Failed to decrypt secret (auth tag mismatch or corrupted data)');
    this.name = 'SecretCipherCorruptedError';
  }
}
