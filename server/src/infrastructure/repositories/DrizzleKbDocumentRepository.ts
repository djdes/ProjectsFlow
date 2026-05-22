import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { kbDocuments, type KbDocumentRow } from '../db/schema.js';
import type {
  KbDocumentRecord,
  KbDocumentRepository,
  UpsertKbDocumentInput,
} from '../../application/kb/KbDocumentRepository.js';

function toRecord(row: KbDocumentRow): KbDocumentRecord {
  return { path: row.path, content: row.content, sha: row.sha };
}

export class DrizzleKbDocumentRepository implements KbDocumentRepository {
  constructor(private readonly db: Database) {}

  async listByProject(projectId: string): Promise<KbDocumentRecord[]> {
    const rows = await this.db
      .select()
      .from(kbDocuments)
      .where(eq(kbDocuments.projectId, projectId))
      .orderBy(asc(kbDocuments.path));
    return rows.map(toRecord);
  }

  async getByPath(projectId: string, path: string): Promise<KbDocumentRecord | null> {
    const rows = await this.db
      .select()
      .from(kbDocuments)
      .where(and(eq(kbDocuments.projectId, projectId), eq(kbDocuments.path, path)))
      .limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async upsert(input: UpsertKbDocumentInput): Promise<void> {
    await this.db
      .insert(kbDocuments)
      .values({
        id: input.id,
        projectId: input.projectId,
        path: input.path,
        content: input.content,
        sha: input.sha,
      })
      .onDuplicateKeyUpdate({ set: { content: input.content, sha: input.sha } });
  }

  async deleteByPath(projectId: string, path: string): Promise<void> {
    await this.db
      .delete(kbDocuments)
      .where(and(eq(kbDocuments.projectId, projectId), eq(kbDocuments.path, path)));
  }
}
