import { SecretKeyInvalidError } from '../../domain/secrets/errors.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { SecretsRepository } from './SecretsRepository.js';

const KEY_RE = /^[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9_]+$/;

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly repo: SecretsRepository;
};

export class PutSecret {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, userId: string, key: string, value: string): Promise<void> {
    if (!KEY_RE.test(key)) throw new SecretKeyInvalidError(key);
    if (value.length === 0) throw new SecretKeyInvalidError('empty value');
    await requireProjectAccess(this.deps, projectId, userId, 'manage_kb');
    await this.deps.repo.upsert(projectId, key, value, userId);
  }
}
