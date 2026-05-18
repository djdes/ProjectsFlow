import { SecretKeyInvalidError } from '../../domain/secrets/errors.js';
import type { SecretsRepository } from './SecretsRepository.js';

const KEY_RE = /^[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9_]+$/;

export class PutSecret {
  constructor(private readonly repo: SecretsRepository) {}

  async execute(userId: string, key: string, value: string): Promise<void> {
    if (!KEY_RE.test(key)) throw new SecretKeyInvalidError(key);
    if (value.length === 0) throw new SecretKeyInvalidError('empty value');
    await this.repo.upsert(userId, key, value);
  }
}
