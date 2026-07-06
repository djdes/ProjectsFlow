import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { siteArtifacts } from '../db/schema.js';
import type { SiteArtifact } from '../../domain/site/SiteArtifact.js';
import type {
  SiteArtifactRepository,
  UpsertSiteInput,
} from '../../application/site/SiteArtifactRepository.js';

type Row = typeof siteArtifacts.$inferSelect;

function toSite(row: Row): SiteArtifact {
  return {
    projectId: row.projectId,
    slug: row.slug,
    fileCount: row.fileCount,
    bytes: Number(row.bytes),
    publishedAt: row.publishedAt,
  };
}

export class DrizzleSiteArtifactRepository implements SiteArtifactRepository {
  constructor(private readonly db: Database) {}

  async getByProject(projectId: string): Promise<SiteArtifact | null> {
    const rows = await this.db
      .select()
      .from(siteArtifacts)
      .where(eq(siteArtifacts.projectId, projectId))
      .limit(1);
    return rows[0] ? toSite(rows[0]) : null;
  }

  async getBySlug(slug: string): Promise<SiteArtifact | null> {
    const rows = await this.db
      .select()
      .from(siteArtifacts)
      .where(eq(siteArtifacts.slug, slug))
      .limit(1);
    return rows[0] ? toSite(rows[0]) : null;
  }

  async upsert(input: UpsertSiteInput): Promise<SiteArtifact> {
    await this.db
      .insert(siteArtifacts)
      .values({
        projectId: input.projectId,
        slug: input.slug,
        fileCount: input.fileCount,
        bytes: input.bytes,
      })
      .onDuplicateKeyUpdate({
        // slug фиксируется первым деплоем; на повторных обновляем счётчики + дату.
        set: {
          fileCount: input.fileCount,
          bytes: input.bytes,
          publishedAt: sql`CURRENT_TIMESTAMP`,
        },
      });
    const row = await this.getByProject(input.projectId);
    if (!row) throw new Error('Failed to read back site artifact after upsert');
    return row;
  }
}
