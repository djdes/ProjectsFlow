import { SecretKeyInvalidError, SecretNotFoundError } from '../../domain/secrets/errors.js';
import type { SecretsRepository } from './SecretsRepository.js';
import type { SecretsCipher } from './SecretsCipher.js';

const KEY_RE = /^[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9_]+$/;

export class GetSecret {
  constructor(
    private readonly repo: SecretsRepository,
    private readonly cipher: SecretsCipher,
  ) {}

  async execute(userId: string, key: string): Promise<string> {
    if (!KEY_RE.test(key)) throw new SecretKeyInvalidError(key);
    const value = await this.repo.getValue(userId, key, this.cipher);
    if (value === null) throw new SecretNotFoundError(key);
    return value;
  }
}
