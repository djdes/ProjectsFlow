import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import { KbNotConnectedError } from '../../domain/kb/errors.js';
import type { ProjectKbStore } from './ProjectKbStore.js';
import type { KbDocumentSummary } from '../../domain/kb/KbDocument.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly kb: ProjectKbStore;
};

export class ListKbDocuments {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, ownerUserId: string): Promise<KbDocumentSummary[]> {
    const { project } = await requireProjectAccess(this.deps, projectId, ownerUserId, 'read_project');
    if (project.kbKind === 'none') throw new KbNotConnectedError();
    return this.deps.kb.list(project);
  }
}
