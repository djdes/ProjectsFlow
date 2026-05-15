import type { KbDocument, KbDocumentSummary } from '../../domain/kb/KbDocument.js';

export type CreateKbRepoInput = {
  readonly accessToken: string;
  readonly name: string;          // "<slug>-kb"
  readonly description: string;
};

export type CreateKbRepoResult = {
  readonly fullName: string;      // "owner/repo"
};

export type ListInput = {
  readonly accessToken: string;
  readonly fullName: string;
  readonly folder?: string;       // если указан — только этот префикс
};

export type ReadInput = {
  readonly accessToken: string;
  readonly fullName: string;
  readonly path: string;
};

export type WriteInput = {
  readonly accessToken: string;
  readonly fullName: string;
  readonly path: string;
  readonly content: string;       // полный исходник md (frontmatter+body)
  readonly message: string;
  readonly sha: string | null;    // null для создания, иначе existing blob sha
};

export interface KbRepository {
  createRepo(input: CreateKbRepoInput): Promise<CreateKbRepoResult>;
  initFolders(accessToken: string, fullName: string): Promise<void>;
  listAll(input: ListInput): Promise<KbDocumentSummary[]>;
  readOne(input: ReadInput): Promise<KbDocument | null>;
  write(input: WriteInput): Promise<{ sha: string }>;
  delete(input: ReadInput & { sha: string; message: string }): Promise<void>;
  exists(accessToken: string, fullName: string): Promise<boolean>;
}
