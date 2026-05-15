export type Frontmatter = Readonly<Record<string, unknown>>;

export type ValidationError = { readonly code: string; readonly message: string };

export type KbDocumentSummary = {
  readonly path: string;
  readonly frontmatter: Frontmatter;
  readonly sha: string | null;
  readonly validationErrors: readonly ValidationError[];
};

export type KbDocument = KbDocumentSummary & {
  readonly body: string;
};
