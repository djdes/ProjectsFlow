import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import type { SecretsRepository, StoredSecret } from './SecretsRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly repo: SecretsRepository;
};

export class ListSecretKeys {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, userId: string): Promise<StoredSecret[]> {
    await requireProjectAccess(this.deps, projectId, userId, 'read_project');
    return this.deps.repo.listKeys(projectId);
  }
}
