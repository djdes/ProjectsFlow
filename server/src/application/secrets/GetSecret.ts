import { SecretKeyInvalidError, SecretNotFoundError } from '../../domain/secrets/errors.js';
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

export class GetSecret {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, userId: string, key: string): Promise<string> {
    if (!KEY_RE.test(key)) throw new SecretKeyInvalidError(key);
    await requireProjectAccess(this.deps, projectId, userId, 'read_secret');
    const value = await this.deps.repo.getValue(projectId, key);
    if (value === null) throw new SecretNotFoundError(key);
    return value;
  }
}
