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

// Служебные поля, которые рантайм ведёт сам и добавляет в каждую запись. Имена в доке —
// в стиле паритета с Base44 (created_date/updated_date/created_by_id), поверх внутренних
// колонок (created_at/updated_at/owner_id). Показываем в OpenAPI, чтобы клиент знал их форму.
const SERVICE_FIELD_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Идентификатор записи' },
    created_date: { type: 'string', format: 'date-time', description: 'Когда запись создана' },
    updated_date: { type: 'string', format: 'date-time', description: 'Когда запись изменена' },
    created_by_id: { type: 'string', nullable: true, description: 'Кто создал запись' },
  },
} as const;

const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' } } as const;
const okRef = { '200': { description: 'OK' } } as const;

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
          parameters: [idParam],
          responses: { '200': { description: 'OK' } },
        },
        delete: {
          summary: `Удалить запись ${table} (мягкое удаление, обратимо через restore)`,
          parameters: [idParam],
          responses: { '200': { description: 'OK' } },
        },
      },
    ],
    [
      `/api/data/${table}/bulk`,
      {
        post: {
          summary: `Создать до 100 записей ${table} за один запрос`,
          description: 'Тело — массив объектов или { items: [...] }. Права проверяются построчно.',
          responses: { '201': { description: 'Created' } },
        },
        put: {
          summary: `Обновить до 100 записей ${table} по списку { id, values }`,
          description: 'Права (owner) проверяются построчно; чужая строка в батче отклоняет запрос.',
          responses: okRef,
        },
      },
    ],
    [
      `/api/data/${table}/update-many`,
      {
        post: {
          summary: `Обновить записи ${table} по условию (до 100 строк)`,
          description:
            'Тело — { where, values }. Условие по чувствительной колонке отклоняется (утечка через счётчик). '
            + 'Под правилом owner изменяются только собственные строки.',
          responses: okRef,
        },
      },
    ],
    [
      `/api/data/${table}/{id}/restore`,
      {
        post: {
          summary: `Восстановить мягко удалённую запись ${table}`,
          parameters: [idParam],
          responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
        },
      },
    ],
  ]));
  return JSON.stringify({
    openapi: '3.1.0',
    info: { title: `ProjectsFlow App API · ${projectId}`, version: '1.0.0' },
    ...(serverUrl ? { servers: [{ url: serverUrl.replace(/\/$/, '') }] } : {}),
    // Bearer-токен сессии опубликованного приложения. Приватные ключи в доке не показываются.
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'Сессионный токен приложения' },
      },
      schemas: { ServiceFields: SERVICE_FIELD_SCHEMA },
    },
  }, null, 2);
}

// «Скопировать для LLM»: вся дока API проекта одним markdown-документом — endpoints, служебные
// поля, аутентификация и встроенный OpenAPI, чтобы отдать ассистенту одним куском.
export function buildProjectApiMarkdown(
  projectName: string,
  projectId: string,
  tableNames: readonly string[],
  serverUrl?: string,
): string {
  const base = serverUrl ? serverUrl.replace(/\/$/, '') : '<адрес-появится-после-публикации>';
  const openApi = buildProjectOpenApi(projectId, tableNames, serverUrl);
  const tablesBlock = tableNames.length
    ? tableNames.map((table) => {
        const p = `${base}/api/data/${table}`;
        return [
          `### ${table}`,
          '',
          `- \`GET ${p}\` — получить и отфильтровать записи`,
          `- \`POST ${p}\` — создать запись`,
          `- \`PATCH ${p}/{id}\` — изменить запись по ID`,
          `- \`DELETE ${p}/{id}\` — мягко удалить запись по ID (обратимо)`,
          `- \`POST ${p}/bulk\` — создать до 100 записей за запрос`,
          `- \`PUT ${p}/bulk\` — обновить до 100 записей по списку { id, values }`,
          `- \`POST ${p}/update-many\` — обновить записи по условию { where, values }`,
          `- \`POST ${p}/{id}/restore\` — восстановить мягко удалённую запись`,
        ].join('\n');
      }).join('\n\n')
    : '_В приложении пока нет опубликованных таблиц._';
  return [
    `# ProjectsFlow App API — ${projectName}`,
    '',
    `- **Base URL:** ${serverUrl ? base : 'приложение ещё не опубликовано'}`,
    `- **Аутентификация:** заголовок \`Authorization: Bearer <session-token>\`.`,
    '',
    '## Служебные поля записи',
    '',
    'Каждая запись содержит поля, которыми управляет рантайм:',
    '',
    '- `id` — идентификатор записи;',
    '- `created_date` — когда создана;',
    '- `updated_date` — когда изменена;',
    '- `created_by_id` — кто создал.',
    '',
    '## Ограничения bulk-операций',
    '',
    '- Потолок батча — 100 записей за запрос.',
    '- Права доступа применяются к каждой строке батча отдельно.',
    '- Условие `update-many` по чувствительной колонке отклоняется.',
    '',
    '## Endpoints',
    '',
    tablesBlock,
    '',
    '## OpenAPI',
    '',
    '```json',
    openApi,
    '```',
    '',
  ].join('\n');
}
