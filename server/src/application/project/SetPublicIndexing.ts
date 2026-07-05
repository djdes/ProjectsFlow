import type { ProjectMemberRepository } from './ProjectMemberRepository.js';
import type { ProjectRepository } from './ProjectRepository.js';
import { requireProjectAccess } from './projectAccess.js';

export type SetPublicIndexingCommand = {
  readonly id: string;
  readonly ownerId: string;
  readonly indexing: boolean;
};

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
};

// Тоггл «Search engine indexing» публичной доски. Owner-only. Публичная страница ставит
// <meta name="robots" content="noindex"> пока indexing=false.
export class SetPublicIndexing {
  constructor(private readonly deps: Deps) {}

  async execute(cmd: SetPublicIndexingCommand): Promise<void> {
    await requireProjectAccess(this.deps, cmd.id, cmd.ownerId, 'manage_public_link');
    await this.deps.projects.setPublicIndexing(cmd.id, cmd.indexing);
  }
}
