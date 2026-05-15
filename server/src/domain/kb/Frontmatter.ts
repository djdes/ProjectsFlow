export type FrontmatterValue = string | number | boolean | null | FrontmatterValue[] | { [k: string]: FrontmatterValue };

export type Frontmatter = Readonly<Record<string, FrontmatterValue>>;

export type KbDocumentType = 'credential' | 'decision' | 'service' | 'schema' | 'runbook' | 'note';

export const KB_FOLDERS: Record<KbDocumentType, string> = {
  credential: 'credentials',
  decision: 'decisions',
  service: 'services',
  schema: 'schemas',
  runbook: 'runbooks',
  note: 'notes',
};
