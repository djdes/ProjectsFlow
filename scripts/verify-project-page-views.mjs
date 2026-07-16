import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const CDP_URL = process.env.CDP_URL ?? 'http://127.0.0.1:9777';
const LOCAL_URL = process.env.PF_LOCAL_URL ?? 'http://192.168.33.214:5181';
const PROJECT_ID = 'pw-project';
const USER_ID = 'pw-user';
const NOW = '2026-07-16T12:00:00.000Z';
const actualDir = resolve('reference/project-page-views/actual');
await mkdir(actualDir, { recursive: true });

const user = {
  id: USER_ID,
  email: 'playwright@local.test',
  displayName: 'Playwright',
  avatarUrl: null,
  isAdmin: true,
  createdAt: NOW,
};
const project = {
  id: PROJECT_ID,
  ownerId: USER_ID,
  name: 'Проект Playwright',
  icon: '🧪',
  status: 'active',
  gitRepoUrl: null,
  kbRepoFullName: null,
  kbKind: 'none',
  isInbox: false,
  role: 'owner',
  memberCount: 2,
  taskCount: 6,
  description: 'Проверка всех режимов отображения',
  coverUrl: null,
  coverPosition: 50,
  createdAt: NOW,
};
const member = {
  projectId: PROJECT_ID,
  userId: USER_ID,
  role: 'owner',
  joinedAt: NOW,
  user: {
    id: USER_ID,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: null,
  },
};
const task = (id, description, status, position, deadline = null) => ({
  id,
  projectId: PROJECT_ID,
  description,
  status,
  statusBeforeDone: null,
  position,
  priority: position % 4 === 0 ? null : ((position % 4) + 1),
  deadline,
  startDate: null,
  parentTaskId: null,
  icon: position % 2 ? '📄' : null,
  cover: null,
  coverPosition: 50,
  creator: { userId: USER_ID, displayName: user.displayName, avatarUrl: null },
  assignee: { userId: USER_ID, displayName: user.displayName, avatarUrl: null },
  createdAt: NOW,
  updatedAt: NOW,
  ralphMode: 'normal',
  ralphCancelRequestedAt: null,
  ralphCancelRequestedBy: null,
  ralphCancelRequestedByDisplayName: null,
});
let tasks = [
  task('task-1', 'Подготовить исследование\nСверить геометрию и состояния.', 'backlog', 0),
  task('task-2', 'Собрать таблицу\nПроверить выделение ячеек.', 'todo', 1, '2026-07-18'),
  task('task-3', 'Настроить календарь', 'in_progress', 2, '2026-07-20'),
  task('task-4', 'Проверить галерею', 'awaiting_clarification', 3),
  task('task-5', 'Собрать отчёт', 'manual', 4, '2026-07-22'),
  task('task-6', 'Готовая задача', 'done', 5, '2026-07-15'),
];
let views = [
  ['view-table', 'Таблица', 'table'],
  ['view-board', 'Доска 2', 'kanban'],
  ['view-list', 'Список', 'list'],
  ['view-calendar', 'Календарь', 'calendar'],
  ['view-timeline', 'Таймлайн', 'timeline'],
  ['view-gallery', 'Галерея', 'gallery'],
  ['view-chart', 'График', 'chart'],
  ['view-feed', 'Лента', 'feed'],
  ['view-map', 'Карта', 'map'],
  ['view-dashboard', 'Дашборд', 'dashboard'],
  ['view-form', 'Форма', 'form'],
].map(([id, name, type], sortOrder) => ({
  id,
  projectId: PROJECT_ID,
  name,
  type,
  sortOrder,
  config: null,
  createdAt: NOW,
}));
let properties = [
  {
    id: 'prop-text',
    projectId: PROJECT_ID,
    name: 'Текст',
    type: 'text',
    options: [],
    position: 0,
  },
];

const json = (route, body, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  });

const browser = await chromium.connectOverCDP(CDP_URL, { timeout: 60_000 });
const context = browser.contexts()[0];
if (!context) throw new Error('Chrome context not found');
for (const candidate of context.pages()) {
  if (candidate.url().startsWith(LOCAL_URL)) await candidate.close();
}
const page = await context.newPage();
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    console.error(`[browser:${message.type()}] ${message.text()}`);
  }
});
page.on('pageerror', (error) => {
  if (!error.message.includes('WebSocket closed without opened')) {
    console.error(`[browser:pageerror] ${error.message}`);
  }
});
await page.unrouteAll({ behavior: 'ignoreErrors' });
await page.route('**/api/**', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname.replace(/^\/api/, '');
  const method = request.method();
  const body = request.postDataJSON?.() ?? {};

  if (path.includes('/stream')) return route.abort('aborted');
  if (path === '/auth/me') return json(route, { user });
  if (path === '/auth/me/usage') {
    return json(route, {
      plan: 'free',
      subscription: { startedAt: null, expiresAt: null },
      windows: {},
      isBlocked: false,
      blockedWindow: null,
      rubPerUsd: 90,
      primeTrialAvailable: true,
      isAdmin: true,
    });
  }
  if (path === '/me/kanban-colors') return json(route, { colors: {} });
  if (path === '/me/ui-prefs') return json(route, { prefs: {} });
  if (path === '/workspaces/chat/rooms') return json(route, { rooms: [] });
  if (path === '/workspaces') {
    return json(route, {
      workspaces: [
        {
          id: 'pw-workspace',
          name: 'Playwright',
          icon: '🧪',
          kind: 'default',
          ownerUserId: USER_ID,
          role: 'owner',
          projectCount: 1,
          memberCount: 2,
          isCurrent: true,
          createdAt: NOW,
        },
      ],
    });
  }
  if (path === '/projects') return json(route, { projects: [project] });
  if (path === `/projects/${PROJECT_ID}`) return json(route, { project });
  if (path === `/projects/${PROJECT_ID}/members`) return json(route, { members: [member] });
  if (path === `/projects/${PROJECT_ID}/shared-members`) {
    return json(route, {
      members: [{ id: USER_ID, displayName: user.displayName, avatarUrl: null }],
    });
  }
  if (path === `/projects/${PROJECT_ID}/tasks` && method === 'GET') {
    return json(route, { tasks });
  }
  if (path === `/projects/${PROJECT_ID}/tasks` && method === 'POST') {
    const created = task(`task-${Date.now()}`, body.description ?? '', body.status ?? 'backlog', tasks.length);
    tasks = [...tasks, created];
    return json(route, { task: created }, 201);
  }
  if (path.match(new RegExp(`^/projects/${PROJECT_ID}/tasks/[^/]+$`)) && method === 'PATCH') {
    const id = path.split('/').at(-1);
    let updated;
    tasks = tasks.map((item) => {
      if (item.id !== id) return item;
      updated = { ...item, ...body, updatedAt: new Date().toISOString() };
      return updated;
    });
    return json(route, { task: updated });
  }
  if (path === `/projects/${PROJECT_ID}/views` && method === 'GET') {
    return json(route, { views });
  }
  if (path === `/projects/${PROJECT_ID}/views` && method === 'POST') {
    const created = {
      id: `view-${Date.now()}`,
      projectId: PROJECT_ID,
      name: body.name ?? 'Новое отображение',
      type: body.type ?? 'table',
      sortOrder: views.length,
      config: null,
      createdAt: new Date().toISOString(),
    };
    views = [...views, created];
    return json(route, { view: created }, 201);
  }
  const viewMatch = path.match(new RegExp(`^/projects/${PROJECT_ID}/views/([^/]+)$`));
  if (viewMatch && method === 'PATCH') {
    let updated;
    views = views.map((view) => {
      if (view.id !== viewMatch[1]) return view;
      updated = { ...view, ...body };
      return updated;
    });
    return json(route, { view: updated });
  }
  if (viewMatch && method === 'DELETE') {
    views = views.filter((view) => view.id !== viewMatch[1]);
    return route.fulfill({ status: 204 });
  }
  if (path.endsWith('/duplicate') && method === 'POST') {
    const id = path.split('/').at(-2);
    const source = views.find((view) => view.id === id);
    const created = {
      ...source,
      id: `view-${Date.now()}`,
      name: `${source?.name ?? 'Вид'} (копия)`,
      sortOrder: views.length,
    };
    views = [...views, created];
    return json(route, { view: created }, 201);
  }
  if (path === `/projects/${PROJECT_ID}/properties` && method === 'GET') {
    return json(route, { properties, values: [] });
  }
  if (path === `/projects/${PROJECT_ID}/properties` && method === 'POST') {
    const created = {
      id: `prop-${Date.now()}`,
      projectId: PROJECT_ID,
      name: body.name ?? 'Новое свойство',
      type: body.type ?? 'text',
      options: body.options ?? [],
      position: properties.length,
    };
    properties = [...properties, created];
    return json(route, { property: created }, 201);
  }
  if (path === `/projects/${PROJECT_ID}/templates`) return json(route, { templates: [] });
  if (path.includes('/notification')) return json(route, { notifications: [], unreadCount: 0 });
  if (path.includes('/recent')) return json(route, { tasks: [] });
  if (path.includes('/automation')) return json(route, { automation: null });
  if (path.includes('/activity')) return json(route, { events: [], nextCursor: null });
  return json(route, {});
});

await page.setViewportSize({ width: 1440, height: 900 });
await page.emulateMedia({ reducedMotion: 'reduce' });
await page
  .goto(`${LOCAL_URL}/projects/${PROJECT_ID}?view=view-table`, {
    waitUntil: 'commit',
    timeout: 15_000,
  })
  .catch((error) => console.error(`[browser:navigation] ${error.message}`));
await page.waitForTimeout(2_000);
console.log(
  JSON.stringify(
    await page.evaluate(() => ({
      ready: document.readyState,
      body: document.body?.innerText?.slice(0, 600),
      resources: performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .slice(-12),
    })),
    null,
    2,
  ),
);
await page.waitForFunction(() => document.getElementById('pf-views-tabs-row') !== null, null, {
  timeout: 30_000,
});
await page.waitForTimeout(800);

const shot = async (name) => {
  await page.screenshot({
    path: resolve(actualDir, name),
    animations: 'disabled',
    fullPage: false,
  });
};
const clickByText = (text) =>
  page.evaluate((needle) => {
    const elements = [...document.querySelectorAll('button,[role="menuitem"],a')];
    const target = elements.find((element) => element.textContent?.trim() === needle);
    if (!target) throw new Error(`Element not found: ${needle}`);
    target.click();
  }, text);

await shot('01-table-default-1440x900.png');

await page.evaluate(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((element) =>
    element.textContent?.includes('Таблица'),
  );
  if (!tab) throw new Error('Table tab not found');
  tab.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      buttons: 2,
      clientX: tab.getBoundingClientRect().left + 24,
      clientY: tab.getBoundingClientRect().bottom - 4,
    }),
  );
});
await page.waitForTimeout(250);
await shot('02-view-context-menu-1440x900.png');
await clickByText('Показывать как');
await page.waitForTimeout(200);
await shot('03-display-as-1440x900.png');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

await page.evaluate(() => {
  document.querySelector('button[aria-label="Настройки отображения"]')?.click();
});
await page.waitForTimeout(350);
await shot('04-view-settings-1440x900.png');
await page.keyboard.press('Escape');

await page.evaluate(() => {
  document.querySelector('button[aria-label="Добавить свойство"]')?.click();
});
await page.waitForTimeout(350);
const addColumnGeometry = await page.evaluate(() => {
  const body = document.querySelector('[data-pf-table-scroll="body"]');
  const picker = document.querySelector('[aria-label="Имя свойства"]')?.closest('[data-radix-popper-content-wrapper]');
  return {
    scrollLeft: body?.scrollLeft ?? null,
    scrollWidth: body?.scrollWidth ?? null,
    clientWidth: body?.clientWidth ?? null,
    pickerVisible: Boolean(picker),
  };
});
await shot('05-add-column-picker-1440x900.png');
await page.keyboard.press('Escape');

await page.evaluate(() => {
  const overflow = [...document.querySelectorAll('button')].find((element) =>
    /ещё \d+/.test(element.textContent ?? ''),
  );
  overflow?.click();
});
await page.waitForTimeout(250);
await shot('06-views-overflow-1440x900.png');
await page
  .getByRole('dialog', { name: 'Все отображения проекта' })
  .getByRole('button', { name: 'Новое отображение', exact: true })
  .last()
  .click();
await page.waitForTimeout(250);
await shot('07-new-view-picker-1440x900.png');
await page.keyboard.press('Escape');

const selectViewByName = async (name) => {
  const visible = await page.evaluate((label) => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find(
      (element) => element.textContent?.trim() === label,
    );
    if (!tab) return false;
    tab.click();
    return true;
  }, name);
  if (!visible) {
    await page.evaluate(() => {
      const overflow = [...document.querySelectorAll('button')].find((element) =>
        /ещё \d+/.test(element.textContent ?? ''),
      );
      if (!overflow) throw new Error('Views overflow button not found');
      overflow.click();
    });
    await page.waitForTimeout(150);
    await page.evaluate((label) => {
      const dialog = document.querySelector(
        '[role="dialog"][aria-label="Все отображения проекта"]',
      );
      const button = [...(dialog?.querySelectorAll('button') ?? [])].find(
        (element) => element.textContent?.trim() === label,
      );
      if (!button) throw new Error(`View not found in overflow: ${label}`);
      button.click();
    }, name);
  }
  await page.waitForTimeout(300);
};

for (const [name, file] of [
  ['Доска 2', '08-board-1440x900.png'],
  ['Список', '09-list-1440x900.png'],
  ['Календарь', '10-calendar-1440x900.png'],
  ['Таймлайн', '11-timeline-1440x900.png'],
  ['Галерея', '12-gallery-1440x900.png'],
  ['График', '13-chart-1440x900.png'],
  ['Лента', '14-feed-1440x900.png'],
  ['Карта', '15-map-1440x900.png'],
  ['Дашборд', '16-dashboard-1440x900.png'],
]) {
  await selectViewByName(name);
  await shot(file);
}
await selectViewByName('Форма');
await shot('17-form-setup-1440x900.png');
await clickByText('Начать с нуля');
await page.waitForTimeout(250);
await shot('18-form-builder-1440x900.png');

await selectViewByName('Таблица');
await page.evaluate(() => {
  for (const selector of [
    '[data-pf-table-scroll="header"]',
    '[data-pf-table-scroll="body"]',
  ]) {
    const scroller = document.querySelector(selector);
    if (!scroller) continue;
    scroller.scrollLeft = 0;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  }
});
await page.setViewportSize({ width: 1024, height: 768 });
await page.waitForTimeout(250);
await shot('19-tablet-1024x768.png');
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(250);
await shot('20-compact-390x844.png');

const report = await page.evaluate(() => {
  const tabs = document.getElementById('pf-views-tabs-row');
  const header = document.querySelector('.pf-sticky-surface');
  const tableScroll = document.querySelector('[data-pf-table-scroll="body"]');
  return {
    url: location.href,
    tabs: tabs ? tabs.getBoundingClientRect().toJSON() : null,
    tabsPosition: tabs ? getComputedStyle(tabs).position : null,
    tableHeader: header ? header.getBoundingClientRect().toJSON() : null,
    tableHeaderPosition: header ? getComputedStyle(header).position : null,
    tableScroll: tableScroll
      ? {
          clientWidth: tableScroll.clientWidth,
          scrollWidth: tableScroll.scrollWidth,
          overflowX: getComputedStyle(tableScroll).overflowX,
        }
      : null,
  };
});
console.log(JSON.stringify({ report, addColumnGeometry }, null, 2));
process.exit(0);
