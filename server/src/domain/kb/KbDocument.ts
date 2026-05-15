import type { Frontmatter } from './Frontmatter.js';

export type ValidationError = {
  readonly code: string;
  readonly message: string;
};

export type KbDocument = {
  readonly path: string;             // "credentials/prod-db.md"
  readonly frontmatter: Frontmatter;
  readonly body: string;             // markdown без --- блоков
  readonly raw: string;              // полный исходник
  readonly sha: string | null;       // GitHub blob SHA (нужен для update)
  readonly validationErrors: readonly ValidationError[];
};

export type KbDocumentSummary = Omit<KbDocument, 'body' | 'raw'>;
