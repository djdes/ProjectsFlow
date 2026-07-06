import { generatePublicSlug } from '../../domain/project/publicSlug.js';
import { requireDispatcherAccess } from '../project/projectAccess.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { SiteArtifactRepository } from './SiteArtifactRepository.js';
import type { SiteArtifactStorage, SiteFile } from './SiteArtifactStorage.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly sites: SiteArtifactRepository;
  readonly storage: SiteArtifactStorage;
  // Инъекция генератора slug для детерминизма в тестах.
  readonly generateSlug?: () => string;
};

const MAX_SLUG_ATTEMPTS = 5;

// Приём собранного статического сайта от диспетчера и его публикация на поддомене.
// Авторизация — назначенный диспетчер проекта (как остальные /agent/*). slug генерится один раз
// при первом деплое (уникальный, отдельный от public_slug доски), дальше переиспользуется.
export class PublishSiteArtifact {
  constructor(private readonly deps: Deps) {}

  async execute(
    projectId: string,
    callerUserId: string,
    files: readonly SiteFile[],
  ): Promise<{ slug: string; publishedAt: Date }> {
    await requireDispatcherAccess(this.deps, projectId, callerUserId);

    const existing = await this.deps.sites.getByProject(projectId);
    const slug = existing?.slug ?? (await this.pickFreshSlug());

    const { fileCount, bytes } = await this.deps.storage.replaceSite(slug, files);
    const row = await this.deps.sites.upsert({ projectId, slug, fileCount, bytes });
    return { slug: row.slug, publishedAt: row.publishedAt };
  }

  private async pickFreshSlug(): Promise<string> {
    const gen = this.deps.generateSlug ?? generatePublicSlug;
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
      const slug = gen();
      if (!(await this.deps.sites.getBySlug(slug))) return slug;
    }
    throw new Error('Failed to generate a unique site slug after retries');
  }
}
