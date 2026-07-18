import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DASHBOARD_SECTIONS,
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
  )) as { paths: Record<string, unknown>; servers: Array<{ url: string }> };
  assert.deepEqual(Object.keys(document.paths), ['/api/data/orders', '/api/data/orders/{id}']);
  assert.deepEqual(document.servers, [{ url: 'https://project.projectsflow.ru' }]);
});
