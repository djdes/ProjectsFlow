import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
};

export class DisconnectKb {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, ownerUserId: string): Promise<void> {
    await requireProjectAccess(this.deps, projectId, ownerUserId, 'manage_kb');
    await this.deps.projects.update(projectId, { kbRepoFullName: null, kbKind: 'none' });
  }
}
