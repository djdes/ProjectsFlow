export const DASHBOARD_SECTIONS = [
  { id: 'overview', label: 'Обзор', icon: 'overview' },
  { id: 'users', label: 'Пользователи', icon: 'users' },
  { id: 'data', label: 'Данные', icon: 'data' },
  { id: 'analytics', label: 'Аналитика', icon: 'analytics' },
  { id: 'marketing', label: 'SEO и маркетинг', icon: 'marketing' },
  { id: 'domains', label: 'Домены', icon: 'domains' },
  { id: 'integrations', label: 'Интеграции', icon: 'integrations' },
  { id: 'security', label: 'Безопасность', icon: 'security' },
  { id: 'code', label: 'Код', icon: 'code' },
  { id: 'agents', label: 'Агенты', icon: 'agents' },
  { id: 'workflows', label: 'Автоматизации', icon: 'workflows' },
  { id: 'logs', label: 'Логи', icon: 'logs' },
  { id: 'api', label: 'API', icon: 'api' },
  { id: 'settings', label: 'Настройки', icon: 'settings' },
] as const;

export type DashboardSection = (typeof DASHBOARD_SECTIONS)[number]['id'];
export type DashboardIconName = (typeof DASHBOARD_SECTIONS)[number]['icon'];

const SECTION_IDS = new Set<string>(DASHBOARD_SECTIONS.map((section) => section.id));

export function resolveDashboardSection(value: string | null | undefined): DashboardSection {
  return value && SECTION_IDS.has(value) ? value as DashboardSection : 'overview';
}

export function formatDashboardBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 Б';
  if (value < 1024) return `${Math.round(value)} Б`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} МБ`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} ГБ`;
}

export function normalizeCustomDomain(value: string): string | null {
  const candidate = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!candidate || candidate.length > 253 || candidate.includes('/') || candidate.includes(':')) return null;
  const labels = candidate.split('.');
  if (labels.length < 2) return null;
  if (labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
  return candidate;
}

export function buildProjectOpenApi(
  projectId: string,
  tableNames: readonly string[],
  serverUrl?: string,
): string {
  const paths = Object.fromEntries(tableNames.flatMap((table) => [
    [
      `/api/data/${table}`,
      {
        get: { summary: `Получить записи ${table}`, responses: { '200': { description: 'OK' } } },
        post: { summary: `Создать запись ${table}`, responses: { '201': { description: 'Created' } } },
      },
    ],
    [
      `/api/data/${table}/{id}`,
      {
        patch: {
          summary: `Изменить запись ${table}`,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'OK' } },
        },
        delete: {
          summary: `Удалить запись ${table}`,
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'OK' } },
        },
      },
    ],
  ]));
  return JSON.stringify({
    openapi: '3.1.0',
    info: { title: `ProjectsFlow App API · ${projectId}`, version: '1.0.0' },
    ...(serverUrl ? { servers: [{ url: serverUrl.replace(/\/$/, '') }] } : {}),
    paths,
  }, null, 2);
}

export type DashboardActionHandlers = {
  readonly saveSeo: (input: { title: string; description: string; robotsIndex: boolean }) => Promise<void>;
  readonly connectDomain: (domain: string) => Promise<void>;
  readonly connectIntegration: (integrationId: string) => Promise<void>;
  readonly saveAgent: (input: { name: string; instructions: string; tools: readonly string[] }) => Promise<void>;
  readonly saveWorkflow: (input: { name: string; trigger: string; action: string }) => Promise<void>;
  readonly saveAppSettings: (input: { description: string; mainRoute: string; visibility: 'public' | 'private' }) => Promise<void>;
  readonly saveAuthSettings: (input: { emailPassword: boolean; google: boolean; microsoft: boolean }) => Promise<void>;
  readonly deleteApp: () => Promise<void>;
};
