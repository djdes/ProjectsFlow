import { requireProjectAccess } from '../project/projectAccess.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { SiteArtifactRepository } from './SiteArtifactRepository.js';

// Сайт-результат проекта для владельца/участника (плашка + вкладка «Сайт проекта»). siteSlug
// есть ВСЕГДА (db/100): до деплоя по нему отдаётся заглушка, после — статика. deployedAt/
// fileCount — из site_artifacts (null/0, пока воркер ничего не задеплоил).
export type ProjectSiteInfo = {
  readonly siteSlug: string | null;
  readonly deployedAt: Date | null;
  readonly fileCount: number;
};

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly sites: SiteArtifactRepository;
};

export class GetProjectSite {
  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, callerUserId: string): Promise<ProjectSiteInfo> {
    const { project } = await requireProjectAccess(this.deps, projectId, callerUserId, 'read_project');
    const artifact = await this.deps.sites.getByProject(projectId);
    return {
      siteSlug: project.siteSlug,
      deployedAt: artifact?.publishedAt ?? null,
      fileCount: artifact?.fileCount ?? 0,
    };
  }
}
