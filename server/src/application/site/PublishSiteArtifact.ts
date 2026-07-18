import { generatePublicSlug } from '../../domain/project/publicSlug.js';
import { requireDispatcherAccess } from '../project/projectAccess.js';
import type { ProjectMemberRepository } from '../project/ProjectMemberRepository.js';
import type { ProjectRepository } from '../project/ProjectRepository.js';
import type { SiteArtifactRepository } from './SiteArtifactRepository.js';
import type { SiteArtifactStorage, SiteFile } from './SiteArtifactStorage.js';
import type { AppDashboardSettingsRepository } from '../app-backend/AppDashboardSettings.js';
import { DEFAULT_APP_DASHBOARD_SETTINGS } from '../app-backend/AppDashboardSettings.js';

type Deps = {
  readonly projects: ProjectRepository;
  readonly members: ProjectMemberRepository;
  readonly sites: SiteArtifactRepository;
  readonly storage: SiteArtifactStorage;
  readonly dashboardSettings?: AppDashboardSettingsRepository;
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

    // Слаг сайта — канонический из projects.site_slug (db/100): тот же адрес, что и заглушка,
    // и что показывают плашка/«Поделиться». Фолбэк (старые данные без site_slug) — существующий
    // slug деплоя или свежесгенерированный.
    const project = await this.deps.projects.getById(projectId);
    const existing = await this.deps.sites.getByProject(projectId);
    const slug = project?.siteSlug ?? existing?.slug ?? (await this.pickFreshSlug());

    const settings = await this.deps.dashboardSettings?.get(projectId) ?? DEFAULT_APP_DASHBOARD_SETTINGS;
    const preparedFiles = files.map((file) => file.path.toLowerCase().endsWith('.html')
      ? { ...file, data: Buffer.from(injectDashboardMetadata(file.data.toString('utf8'), {
        title: settings.seo.title || project?.name || '',
        description: settings.seo.description || project?.description || '',
        canonicalUrl: settings.seo.canonicalUrl,
        robotsIndex: settings.seo.robotsIndex,
        socialImageUrl: settings.branding.socialImageUrl,
        showPlatformBadge: settings.branding.showPlatformBadge,
        structuredData: settings.seo.structuredData,
      }), 'utf8') }
      : file);
    const { fileCount, bytes } = await this.deps.storage.replaceSite(slug, preparedFiles);
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

type Metadata = {
  readonly title: string;
  readonly description: string;
  readonly canonicalUrl: string;
  readonly robotsIndex: boolean;
  readonly socialImageUrl: string;
  readonly showPlatformBadge: boolean;
  readonly structuredData: string;
};

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function injectDashboardMetadata(html: string, metadata: Metadata): string {
  const clean = html
    .replace(/<!-- projectsflow:seo:start -->[\s\S]*?<!-- projectsflow:seo:end -->\s*/i, '')
    .replace(/<title(?:\s[^>]*)?>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<meta\s+(?:name|property)=["'](?:description|robots|og:title|og:description|og:image)["'][^>]*>\s*/gi, '')
    .replace(/<link\s+rel=["']canonical["'][^>]*>\s*/gi, '')
    .replace(/<script\s+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>\s*/gi, '');
  const tags = [
    '<!-- projectsflow:seo:start -->',
    metadata.title ? `<title>${escapeHtml(metadata.title)}</title>` : '',
    metadata.description ? `<meta name="description" content="${escapeHtml(metadata.description)}">` : '',
    `<meta name="robots" content="${metadata.robotsIndex ? 'index,follow' : 'noindex,nofollow'}">`,
    metadata.canonicalUrl ? `<link rel="canonical" href="${escapeHtml(metadata.canonicalUrl)}">` : '',
    metadata.title ? `<meta property="og:title" content="${escapeHtml(metadata.title)}">` : '',
    metadata.description ? `<meta property="og:description" content="${escapeHtml(metadata.description)}">` : '',
    metadata.socialImageUrl ? `<meta property="og:image" content="${escapeHtml(metadata.socialImageUrl)}">` : '',
    metadata.structuredData ? `<script type="application/ld+json">${metadata.structuredData.replaceAll('</script', '<\\/script')}</script>` : '',
    '<!-- projectsflow:seo:end -->',
  ].filter(Boolean).join('\n');
  const withHead = /<head(?:\s[^>]*)?>/i.test(clean) ? clean.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}\n${tags}`) : `${tags}\n${clean}`;
  if (!metadata.showPlatformBadge) return withHead;
  const badge = '<a href="https://projectsflow.ru" target="_blank" rel="noopener noreferrer" data-projectsflow-badge style="position:fixed;right:16px;bottom:16px;z-index:2147483646;padding:8px 12px;border:1px solid rgba(0,0,0,.12);border-radius:999px;background:#fff;color:#171717;font:600 12px/1 system-ui;text-decoration:none;box-shadow:0 6px 24px rgba(0,0,0,.12)">Создано в ProjectsFlow</a>';
  return withHead.includes('</body>') ? withHead.replace('</body>', `${badge}</body>`) : `${withHead}${badge}`;
}
