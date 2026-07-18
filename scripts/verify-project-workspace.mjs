import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const CDP_URL = process.env.CDP_URL ?? 'http://127.0.0.1:9222';
const LOCAL_URL = process.env.PF_LOCAL_URL ?? 'http://127.0.0.1:5181';
const outputDir = resolve('reference/project-workspace/actual');
await mkdir(outputDir, { recursive: true });

const now = '2026-07-18T12:00:00.000Z';
const projectId = 'workspace-preview-project';
const user = {
  id: 'workspace-preview-user',
  email: 'preview@local.test',
  displayName: 'Ярослав Боев',
  avatarUrl: null,
  isAdmin: true,
  createdAt: now,
};
const project = {
  id: projectId,
  ownerId: user.id,
  name: 'Магазин будущего',
  icon: '🚀',
  status: 'active',
  gitRepoUrl: 'https://github.com/example/future-shop',
  kbRepoFullName: 'example/future-shop-kb',
  kbKind: 'github',
  isInbox: false,
  role: 'owner',
  memberCount: 3,
  taskCount: 4,
  description: 'Интернет-магазин с личным кабинетом и заказами',
  coverUrl: null,
  coverPosition: 50,
  createdAt: now,
};
const members = [
  { projectId, userId: user.id, role: 'owner', joinedAt: now, user },
  { projectId, userId: 'member-2', role: 'editor', joinedAt: now, user: { id: 'member-2', email: 'denis@example.test', displayName: 'Денис Волков', avatarUrl: null } },
  { projectId, userId: 'member-3', role: 'viewer', joinedAt: now, user: { id: 'member-3', email: 'oleg@example.test', displayName: 'Олег', avatarUrl: null } },
];
const tasks = [
  ['task-1', 'Собрать каталог товаров', 'backlog'],
  ['task-2', 'Добавить оформление заказа', 'todo'],
  ['task-3', 'Подключить оплату', 'in_progress'],
  ['task-4', 'Проверить мобильную версию', 'done'],
].map(([id, description, status], position) => ({
  id,
  projectId,
  description,
  status,
  statusBeforeDone: null,
  position,
  priority: position + 1,
  deadline: position === 1 ? '2026-07-20' : null,
  startDate: null,
  parentTaskId: null,
  icon: null,
  cover: null,
  coverPosition: 50,
  creator: { userId: user.id, displayName: user.displayName, avatarUrl: null },
  assignee: { userId: user.id, displayName: user.displayName, avatarUrl: null },
  createdAt: now,
  updatedAt: now,
  ralphMode: 'normal',
  ralphCancelRequestedAt: null,
  ralphCancelRequestedBy: null,
  ralphCancelRequestedByDisplayName: null,
}));
const views = [
  { id: 'view-kanban', projectId, name: 'Доска', type: 'kanban', sortOrder: 0, config: null, createdAt: now },
  { id: 'view-table', projectId, name: 'Таблица', type: 'table', sortOrder: 1, config: null, createdAt: now },
  { id: 'view-list', projectId, name: 'Список', type: 'list', sortOrder: 2, config: null, createdAt: now },
  { id: 'view-calendar', projectId, name: 'Календарь', type: 'calendar', sortOrder: 3, config: null, createdAt: now },
];
const schema = {
  tables: [
    {
      name: 'orders',
      fields: [
        { name: 'customer', type: 'text', required: true },
        { name: 'amount', type: 'real', required: true },
        { name: 'paid', type: 'bool' },
        { name: 'ordered_at', type: 'datetime' },
      ],
      rules: { read: 'owner', write: 'owner', create: 'authenticated', update: 'owner', delete: 'owner' },
    },
    {
      name: 'products',
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'stock', type: 'int' },
      ],
      rules: { read: 'anyone', write: 'owner' },
    },
  ],
};
const rows = [
  { id: 'order-1042', owner_id: user.id, created_at: now, customer: 'Анна', amount: 12990, paid: true, ordered_at: now },
  { id: 'order-1041', owner_id: user.id, created_at: now, customer: 'Максим', amount: 7490, paid: false, ordered_at: now },
  { id: 'order-1040', owner_id: user.id, created_at: now, customer: 'Елена', amount: 21990, paid: true, ordered_at: now },
];

const ownsBrowser = process.env.PF_HEADLESS === '1';
const browser = ownsBrowser
  ? await chromium.launch({ headless: true, channel: 'chrome' })
  : await chromium.connectOverCDP(CDP_URL, { timeout: 60_000 });
const context = ownsBrowser ? await browser.newContext() : browser.contexts()[0];
if (!context) throw new Error('Chrome context not found');
const page = await context.newPage();
await page.setViewportSize({ width: 1440, height: 900 });
const failures = [];
const requests = [];
page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') failures.push(`console: ${message.text()}`);
});

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
await page.route(/^https:\/\/future-shop\.projectsflow\.ru(?:\/.*)?$/, (route) => route.fulfill({
  status: 200,
  contentType: 'text/html; charset=utf-8',
  body: '<!doctype html><html><body style="font-family:system-ui;margin:0;background:#f7f8fb"><header style="padding:22px 36px;background:white;border-bottom:1px solid #e5e7eb;font-weight:700">Future Shop</header><main style="padding:52px 36px"><p style="color:#2563eb;font-weight:600">Новая коллекция</p><h1 style="font-size:48px;max-width:720px">Всё нужное — в одном красивом магазине</h1><button style="background:#111827;color:white;border:0;border-radius:12px;padding:14px 22px">Смотреть каталог</button></main></body></html>',
}));
await page.route('**/api/**', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname.replace(/^\/api/, '');
  const method = request.method();
  requests.push(`${method} ${path}`);
  if (path.includes('/stream')) return route.abort('aborted');
  if (path === '/auth/me') return json(route, { user });
  if (path === '/auth/me/usage') return json(route, { plan: 'prime', subscription: { startedAt: now, expiresAt: null }, windows: {}, isBlocked: false, blockedWindow: null, rubPerUsd: 90, primeTrialAvailable: false, isAdmin: true });
  if (path === '/me/kanban-colors') return json(route, { colors: {} });
  if (path === '/me/ui-prefs') return json(route, { prefs: {} });
  if (path === '/workspaces/chat/rooms') return json(route, { rooms: [] });
  if (path === '/workspaces') return json(route, { workspaces: [{ id: 'workspace-1', name: 'Команда', icon: '🚀', kind: 'team', ownerUserId: user.id, role: 'owner', projectCount: 1, memberCount: 3, isCurrent: true, createdAt: now }] });
  if (path === '/projects') return json(route, { projects: [project] });
  if (path === `/projects/${projectId}`) return json(route, { project });
  if (path === `/projects/${projectId}/members`) return json(route, { members });
  if (path === `/projects/${projectId}/shared-members`) return json(route, { members: members.map((item) => item.user) });
  if (path === `/projects/${projectId}/tasks`) return json(route, { tasks });
  if (path === `/projects/${projectId}/views`) return json(route, { views });
  if (path === `/projects/${projectId}/properties`) return json(route, { properties: [], values: [] });
  if (path === `/projects/${projectId}/site`) return json(route, { siteSlug: 'future-shop', deployedAt: now, fileCount: 34, routes: ['/', '/catalog', '/checkout'] });
  if (path === `/projects/${projectId}/app-backend`) return json(route, { status: 'active', usageBytes: 184320, storageLimitBytes: 52428800, tables: ['orders', 'products'] });
  if (path === `/projects/${projectId}/app-backend/dashboard`) return json(route, { status: 'active', usageBytes: 184320, storageLimitBytes: 52428800, schema, updatedAt: now });
  if (path === `/projects/${projectId}/app-backend/tables/orders/query`) return json(route, { rows, total: rows.length, limit: 50, offset: 0 });
  if (path === `/projects/${projectId}/app-backend/tables/products/query`) return json(route, { rows: [{ id: 'product-1', owner_id: null, created_at: now, name: 'Наушники', stock: 42 }], total: 1, limit: 50, offset: 0 });
  if (path === `/projects/${projectId}/app-backend/logs`) return json(route, { rows: [
    { id: 'log-1', actorType: 'runtime', actorId: 'customer-7', operation: 'select', tableName: 'products', rowId: null, success: true, detail: { fields: ['name', 'stock'] }, createdAt: now },
    { id: 'log-2', actorType: 'project_member', actorId: user.id, operation: 'dashboard.update', tableName: 'orders', rowId: 'order-1041', success: true, detail: { fields: ['paid'] }, createdAt: now },
  ], total: 2 });
  if (path.startsWith(`/projects/${projectId}/activity`)) return json(route, { items: [], nextCursor: null });
  if (path.startsWith(`/projects/${projectId}/commits`)) return json(route, { commits: [] });
  return json(route, {});
});

const screenshot = (name) => page.screenshot({ path: resolve(outputDir, name), animations: 'disabled' });
try {
  await page.goto(`${LOCAL_URL}/projects/${projectId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('tab', { name: 'Preview' }).waitFor({ timeout: 10_000 });
  await screenshot('01-tasks-1440x900.png');

  await page.getByRole('tab', { name: 'Preview' }).click();
  await page.locator('iframe').waitFor({ timeout: 30_000 });
  await page.frameLocator('iframe').getByText('Future Shop', { exact: true }).waitFor({ timeout: 10_000 });
  await screenshot('02-preview-desktop-1440x900.png');
  await page.getByRole('button', { name: 'Телефон' }).click();
  await screenshot('03-preview-mobile-device-1440x900.png');

  await page.getByRole('tab', { name: 'Dashboard' }).click();
  await page.getByText('Автоматические проверки', { exact: true }).waitFor({ timeout: 30_000 });
  await screenshot('04-dashboard-overview-1440x900.png');
  await page.getByRole('button', { name: /Данные/ }).click();
  await page.getByText('order-1042', { exact: true }).waitFor({ timeout: 30_000 });
  await screenshot('05-dashboard-data-1440x900.png');
  await page.getByRole('button', { name: /Логи/ }).click();
  await page.getByRole('button', { name: /Изменение в Dashboard orders/ }).waitFor({ timeout: 30_000 });
  await screenshot('06-dashboard-logs-1440x900.png');

  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot('07-dashboard-mobile-390x844.png');
  console.log(JSON.stringify({ ok: failures.length === 0, failures, outputDir }, null, 2));
  if (failures.length > 0) process.exitCode = 1;
} catch (error) {
  await page.screenshot({ path: resolve(outputDir, '00-failure.png'), timeout: 5_000 }).catch(() => undefined);
  console.error(JSON.stringify({
    error: error instanceof Error ? error.message : String(error),
    failures,
    requests,
    url: page.url(),
    body: (await page.locator('body').innerText().catch(() => '')).slice(0, 2000),
  }, null, 2));
  process.exitCode = 1;
} finally {
  await page.close();
  if (ownsBrowser) await browser.close();
}
