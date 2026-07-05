import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import { requireProjectAccess } from './projectAccess.js';

export type UnpublishProjectCommand = {
  readonly id: string;
  readonly ownerId: string;
};

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
};

// Снять доску с публикации (is_public=0). Owner-only. public_slug сохраняется — повторный
// Publish вернёт тот же URL.
export class UnpublishProject {
  constructor(private readonly deps: Deps) {}

  async execute(cmd: UnpublishProjectCommand): Promise<void> {
    await requireProjectAccess(this.deps, cmd.id, cmd.ownerId, 'manage_public_link');
    await this.deps.projects.unpublish(cmd.id);
  }
}
