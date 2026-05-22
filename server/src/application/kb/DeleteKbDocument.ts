import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import { KbDocumentNotFoundError, KbNotConnectedError } from '../../domain/kb/errors.js';
import type { ProjectKbStore } from './ProjectKbStore.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly kb: ProjectKbStore;
};

export class DeleteKbDocument {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, userId: string, path: string): Promise<void> {
    const { project } = await requireProjectAccess(this.deps, projectId, userId, 'manage_kb');
    if (project.kbKind === 'none') throw new KbNotConnectedError();

    const existing = await this.deps.kb.read(project, path);
    if (!existing || !existing.sha) throw new KbDocumentNotFoundError(path);

    await this.deps.kb.delete(project, {
      path,
      sha: existing.sha,
      message: `chore(kb): delete ${path} via ProjectsFlow UI`,
    });
  }
}
