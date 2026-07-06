import type { SiteArtifact } from '../../domain/site/SiteArtifact.js';

export type UpsertSiteInput = {
  readonly projectId: string;
  readonly slug: string;
  readonly fileCount: number;
  readonly bytes: number;
};

export interface SiteArtifactRepository {
  getByProject(projectId: string): Promise<SiteArtifact | null>;
  // Lookup по slug — для host-роутинга поддомена и проверки коллизий при генерации.
  getBySlug(slug: string): Promise<SiteArtifact | null>;
  // Upsert одной строки на проект: обновляет slug (первый деплой)/counters + published_at.
  upsert(input: UpsertSiteInput): Promise<SiteArtifact>;
}
