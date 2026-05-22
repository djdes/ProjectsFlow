import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import { requireProjectAccess } from '../project/projectAccess.js';
import { KbDocumentNotFoundError, KbNotConnectedError } from '../../domain/kb/errors.js';
import type { ProjectKbStore } from './ProjectKbStore.js';
import type { KbDocument } from '../../domain/kb/KbDocument.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly kb: ProjectKbStore;
};

export class GetKbDocument {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, ownerUserId: string, path: string): Promise<KbDocument> {
    const { project } = await requireProjectAccess(this.deps, projectId, ownerUserId, 'read_project');
    if (project.kbKind === 'none') throw new KbNotConnectedError();
    const doc = await this.deps.kb.read(project, path);
    if (!doc) throw new KbDocumentNotFoundError(path);
    return doc;
  }
}
