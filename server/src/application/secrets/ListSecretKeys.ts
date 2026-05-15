import type { SecretsRepository, StoredSecret } from './SecretsRepository.js';

export class ListSecretKeys {
  constructor(private readonly repo: SecretsRepository) {}

  execute(userId: string): Promise<StoredSecret[]> {
    return this.repo.listKeys(userId);
  }
}
