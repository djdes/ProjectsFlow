import type { PublicAppearance } from '../../domain/project/Project.js';
import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import { requireProjectAccess } from './projectAccess.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
};

export class SetPublicAppearance {
  constructor(private readonly deps: Deps) {}

  async execute(input: {
    readonly id: string;
    readonly userId: string;
    readonly appearance: PublicAppearance;
  }): Promise<void> {
    await requireProjectAccess(this.deps, input.id, input.userId, 'manage_public_link');
    await this.deps.projects.update(input.id, { publicAppearance: input.appearance });
  }
}
