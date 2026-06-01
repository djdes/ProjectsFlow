export type FrontmatterValue = string | number | boolean | null | FrontmatterValue[] | { [k: string]: FrontmatterValue };

export type Frontmatter = Readonly<Record<string, FrontmatterValue>>;

export type KbDocumentType =
  | 'credential'
  | 'decision'
  | 'service'
  | 'schema'
  | 'runbook'
  | 'note'
  | 'agent'
  | 'monitoring';

export const KB_FOLDERS: Record<KbDocumentType, string> = {
  credential: 'credentials',
  decision: 'decisions',
  service: 'services',
  schema: 'schemas',
  runbook: 'runbooks',
  note: 'notes',
  agent: 'agents',
  // Авто-генерируемые снимки мониторинга (только метрики, без логов).
  monitoring: 'monitoring',
};
