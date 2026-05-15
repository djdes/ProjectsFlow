import type { Frontmatter, KbDocument, KbDocumentSummary } from '@/domain/kb/KbDocument';

export interface KbRepository {
  initRepo(projectId: string): Promise<{ fullName: string }>;
  connectRepo(projectId: string, fullName: string): Promise<void>;
  disconnect(projectId: string): Promise<void>;
  list(projectId: string): Promise<KbDocumentSummary[]>;
  get(projectId: string, path: string): Promise<KbDocument>;
  write(projectId: string, path: string, frontmatter: Frontmatter, body: string, sha: string | null): Promise<{ sha: string }>;
  delete(projectId: string, path: string): Promise<void>;
}
