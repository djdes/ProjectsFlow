import type { Frontmatter, KbDocument, KbDocumentSummary } from '@/domain/kb/KbDocument';
import type {
  BulkCreateInput,
  BulkCreateResult,
  KbRepository,
  ParsedBulkPreview,
} from '@/application/kb/KbRepository';
import { httpClient } from './httpClient';

export class HttpKbRepository implements KbRepository {
  async initRepo(projectId: string): Promise<{ fullName: string }> {
    return httpClient.post<{ fullName: string }>(`/projects/${projectId}/kb/init`);
  }
  async initLocal(projectId: string): Promise<void> {
    await httpClient.post<void>(`/projects/${projectId}/kb/init-local`);
  }
  async connectRepo(projectId: string, fullName: string): Promise<void> {
    await httpClient.post<void>(`/projects/${projectId}/kb/connect`, { fullName });
  }
  async disconnect(projectId: string): Promise<void> {
    await httpClient.delete<void>(`/projects/${projectId}/kb`);
  }
  async list(projectId: string): Promise<KbDocumentSummary[]> {
    const { documents } = await httpClient.get<{ documents: KbDocumentSummary[] }>(
      `/projects/${projectId}/kb/tree`,
    );
    return documents;
  }
  async get(projectId: string, path: string): Promise<KbDocument> {
    const { document } = await httpClient.get<{ document: KbDocument }>(
      `/projects/${projectId}/kb/documents/${path}`,
    );
    return document;
  }
  async write(
    projectId: string,
    path: string,
    frontmatter: Frontmatter,
    body: string,
    sha: string | null,
  ): Promise<{ sha: string }> {
    return httpClient.put<{ sha: string }>(`/projects/${projectId}/kb/documents/${path}`, {
      frontmatter,
      body,
      sha,
    });
  }
  async delete(projectId: string, path: string): Promise<void> {
    await httpClient.delete<void>(`/projects/${projectId}/kb/documents/${path}`);
  }
  async parseBulkCredential(projectId: string, rawText: string): Promise<ParsedBulkPreview> {
    return httpClient.post<ParsedBulkPreview>(
      `/projects/${projectId}/kb/credentials/parse`,
      { rawText },
    );
  }
  async bulkCreateCredential(projectId: string, input: BulkCreateInput): Promise<BulkCreateResult> {
    return httpClient.post<BulkCreateResult>(
      `/projects/${projectId}/kb/credentials/bulk`,
      input,
    );
  }
}
