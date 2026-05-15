import { SecretKeyInvalidError } from '../../domain/secrets/errors.js';
import type { SecretsRepository } from './SecretsRepository.js';

const KEY_RE = /^[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9_]+$/;

export class DeleteSecret {
  constructor(private readonly repo: SecretsRepository) {}

  async execute(userId: string, key: string): Promise<boolean> {
    if (!KEY_RE.test(key)) throw new SecretKeyInvalidError(key);
    return this.repo.delete(userId, key);
  }
}
