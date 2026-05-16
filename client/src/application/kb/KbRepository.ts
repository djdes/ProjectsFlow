import type { Frontmatter, KbDocument, KbDocumentSummary } from '@/domain/kb/KbDocument';

export type ParsedBulkField = {
  readonly key: string;
  readonly value: string;
  readonly isSecret: boolean;
};

export type ParsedBulkPreview = {
  readonly title: string;
  readonly kind: string | null;
  readonly fields: readonly ParsedBulkField[];
  readonly suggestedFileSlug: string;
};

export type BulkCreateInput = {
  readonly rawText: string;
  readonly fileSlugOverride?: string | null;
  readonly secretOverrides?: Readonly<Record<string, boolean>> | null;
};

export type BulkCreateResult = {
  readonly path: string;
  readonly sha: string;
  readonly secretsWritten: readonly string[];
};

export interface KbRepository {
  initRepo(projectId: string): Promise<{ fullName: string }>;
  connectRepo(projectId: string, fullName: string): Promise<void>;
  disconnect(projectId: string): Promise<void>;
  list(projectId: string): Promise<KbDocumentSummary[]>;
  get(projectId: string, path: string): Promise<KbDocument>;
  write(
    projectId: string,
    path: string,
    frontmatter: Frontmatter,
    body: string,
    sha: string | null,
  ): Promise<{ sha: string }>;
  delete(projectId: string, path: string): Promise<void>;
  parseBulkCredential(projectId: string, rawText: string): Promise<ParsedBulkPreview>;
  bulkCreateCredential(projectId: string, input: BulkCreateInput): Promise<BulkCreateResult>;
}
