import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DASHBOARD_SECTIONS,
  buildProjectApiMarkdown,
  buildProjectOpenApi,
  formatDashboardBytes,
  normalizeCustomDomain,
  resolveDashboardSection,
} from './dashboardConfig';

test('dashboard registry contains fourteen unique sections', () => {
  assert.equal(DASHBOARD_SECTIONS.length, 14);
  assert.equal(new Set(DASHBOARD_SECTIONS.map((section) => section.id)).size, 14);
});

test('dashboard section resolver rejects unknown deep links', () => {
  assert.equal(resolveDashboardSection('logs'), 'logs');
  assert.equal(resolveDashboardSection('billing'), 'overview');
  assert.equal(resolveDashboardSection(null), 'overview');
});

test('dashboard formatters are deterministic', () => {
  assert.equal(formatDashboardBytes(0), '0 Б');
  assert.equal(formatDashboardBytes(1536), '1.5 КБ');
  assert.equal(normalizeCustomDomain('https://App.Example.com/'), 'app.example.com');
  assert.equal(normalizeCustomDomain('localhost:3000'), null);
});

test('OpenAPI document only contains requested project tables', () => {
  const document = JSON.parse(buildProjectOpenApi(
    'project-1',
    ['orders'],
    'https://project.projectsflow.ru/',
  )) as {
    openapi: string;
    paths: Record<string, unknown>;
    servers: Array<{ url: string }>;
    security: Array<Record<string, unknown>>;
    components: { securitySchemes: Record<string, { type: string; scheme?: string }>; schemas: Record<string, unknown> };
  };
  assert.equal(document.openapi, '3.1.0');
  // Каждый эндпоинт — только для запрошенной таблицы; чужих таблиц в документе нет.
  assert.deepEqual(Object.keys(document.paths).sort(), [
    '/api/data/orders',
    '/api/data/orders/bulk',
    '/api/data/orders/update-many',
    '/api/data/orders/{id}',
    '/api/data/orders/{id}/restore',
  ]);
  assert.deepEqual(document.servers, [{ url: 'https://project.projectsflow.ru' }]);
  // Bearer securityScheme объявлен и применён глобально.
  assert.equal(document.components.securitySchemes['bearerAuth']?.type, 'http');
  assert.equal(document.components.securitySchemes['bearerAuth']?.scheme, 'bearer');
  assert.deepEqual(document.security, [{ bearerAuth: [] }]);
  // Служебные поля документированы (updated_date/created_by_id).
  const service = document.components.schemas['ServiceFields'] as { properties: Record<string, unknown> };
  assert.ok('updated_date' in service.properties);
  assert.ok('created_by_id' in service.properties);
  // bulk-путь несёт и POST (создать), и PUT (обновить).
  const bulk = document.paths['/api/data/orders/bulk'] as Record<string, unknown>;
  assert.ok('post' in bulk && 'put' in bulk);
});

test('LLM markdown collects the whole API into one document', () => {
  const markdown = buildProjectApiMarkdown(
    'Мой проект',
    'project-1',
    ['orders'],
    'https://project.projectsflow.ru/',
  );
  assert.ok(markdown.includes('# ProjectsFlow App API — Мой проект'));
  assert.ok(markdown.includes('/api/data/orders/bulk'));
  assert.ok(markdown.includes('/api/data/orders/update-many'));
  assert.ok(markdown.includes('/api/data/orders/{id}/restore'));
  assert.ok(markdown.includes('Authorization: Bearer'));
  assert.ok(markdown.includes('updated_date'));
  assert.ok(markdown.includes('```json'));
});
