import { requireProjectAccess } from '../project/projectAccess.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { SiteArtifact } from '../../domain/site/SiteArtifact.js';
import type { SiteArtifactRepository } from './SiteArtifactRepository.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly sites: SiteArtifactRepository;
};

// Метаданные задеплоенного сайта проекта для владельца/участника (кнопка «Результат»).
// null — сайт ещё не деплоился.
export class GetProjectSite {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, callerUserId: string): Promise<SiteArtifact | null> {
    await requireProjectAccess(this.deps, projectId, callerUserId, 'read_project');
    return this.deps.sites.getByProject(projectId);
  }
}
