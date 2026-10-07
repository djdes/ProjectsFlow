async (page) => {
  await page.unroute('**/api/**');
  const now = '2026-10-07T12:00:00Z';
  const user = {
    id: 'owner',
    email: 'owner@example.test',
    displayName: 'Алексей',
    avatarUrl: null,
    isAdmin: false,
    createdAt: now,
  };
  const workspace = {
    id: 'access-ws',
    name: 'Команда проекта',
    icon: '🚀',
    kind: 'team',
    ownerUserId: 'owner',
    role: 'owner',
    projectCount: 3,
    memberCount: 4,
    isCurrent: true,
    requireTaskApproval: true,
    workerEnabled: false,
    commitSyncMode: 'off',
    createdAt: now,
  };
  const members = [
    {
      userId: 'owner',
      displayName: 'Алексей',
      email: 'owner@example.test',
      role: 'owner',
      avatarUrl: null,
    },
    {
      userId: 'lead',
      displayName: 'Наталья',
      email: 'lead@example.test',
      role: 'lead',
      avatarUrl: null,
    },
    {
      userId: 'editor',
      displayName: 'Денис Волков',
      email: 'editor@example.test',
      role: 'editor',
      avatarUrl: null,
    },
    {
      userId: 'viewer',
      displayName: 'Анна',
      email: 'viewer@example.test',
      role: 'viewer',
      avatarUrl: null,
    },
  ];
  const projects = [
    'Сайт компании',
    'Каталог товаров',
    'Внутренние процессы',
  ].map((name, i) => ({
    id: 'access-p' + i,
    workspaceId: workspace.id,
    name,
    icon: ['🚀', '📦', '⚙️'][i],
    ownerId: 'owner',
    isInbox: false,
    role: 'owner',
    status: 'active',
    memberCount: 4,
    taskCount: 0,
    description: null,
    coverUrl: null,
    gitRepoUrl: 'https://github.com/example/fixture',
    kbRepoFullName: null,
    kbKind: 'native',
    financeVisibility: 'all',
    createdAt: now,
  }));
  const hidden = new Map(members.map((m) => [m.userId, []]));
  const invites = [];
  const writes = [];
  const tasks = [
    '**Синхронизация данных** и НДС\n\nБухгалтерия просит настроить **синхронизацию** по Сабу и учесть НДС в реализациях.',
    'Добавить **фото товаров** на сайт\n\nПодготовить *оригинальные фотографии* и проверить карточки каталога.',
    'Проверить остатки на складе',
  ].map((description, i) => ({
    id: 'format-t' + i,
    projectId: 'access-p0',
    description,
    status: 'backlog',
    position: i,
    assignee: {
      userId: user.id,
      displayName: user.displayName,
      avatarUrl: null,
    },
    creator: {
      userId: user.id,
      displayName: user.displayName,
      avatarUrl: null,
    },
    icon: null,
    cover: null,
    coverPosition: 50,
    priority: null,
    deadline: null,
    startDate: null,
    parentTaskId: null,
    taskType: 'feature',
    ralphMode: 'normal',
    createdAt: now,
    updatedAt: now,
    attachmentCount: 0,
    commentCount: 0,
    commitCount: 0,
  }));
  globalThis.formattingFixture = { tasks, writes, failSave: false, delay: 0 };
  const controls = {
    delay: 400,
    authDelay: 1000,
    taskDelay: 1400,
    failPath: null,
    empty: false,
  };
  const requests = [];
  page.on('pageerror', (error) => writes.push({ error: error.message }));
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api/, '');
    const method = req.method();
    const json = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(body),
      });
    if (path === '/fixture/state')
      return json({ tasks, writes, requests, controls });
    if (path === '/fixture/control') {
      Object.assign(globalThis.formattingFixture, req.postDataJSON());
      Object.assign(controls, req.postDataJSON());
      return json({ ok: true });
    }
    if (path.includes('/stream'))
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: ': fixture\n\n',
      });
    requests.push({ path, method });
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        path === '/auth/me'
          ? controls.authDelay
          : path.endsWith('/tasks') || path.endsWith('/views')
            ? controls.taskDelay
            : controls.delay,
      ),
    );
    if (controls.failPath && path.includes(controls.failPath))
      return json(
        { error: 'unavailable', message: 'Тестовая ошибка загрузки' },
        503,
      );
    if (path === '/inbox')
      return json({
        project: {
          ...projects[0],
          id: 'inbox',
          name: 'Входящие',
          isInbox: true,
        },
      });
    if (path === '/projects/inbox/tasks') return json({ tasks: [] });
    if (path.startsWith('/assignees/'))
      return json({
        items:
          path === '/assignees/mine' && !controls.empty
            ? tasks.map((task) => ({
                task,
                projectId: task.projectId,
                projectName: projects[0].name,
                isInbox: false,
                canModify: true,
              }))
            : [],
      });
    if (path === '/monitoring/overview') return json({ projects: [] });
    if (path === '/me/stats/completed-by-workspace')
      return json({ workspaces: [] });
    if (path === '/me/unread-tasks') return json({ taskIds: [] });
    if (path === '/recent-task-views') return json({ views: [], items: [] });
    if (path.includes('/monitoring/alerts')) return json({ alerts: [] });
    if (path.includes('/monitoring/servers')) return json({ servers: [] });
    if (path.endsWith('/finance/summary'))
      return json({
        finance: {
          labor: [],
          expenses: [],
          incomes: [],
          laborTotalKopecks: 0,
          otherExpensesTotalKopecks: 0,
          incomeTotalKopecks: 0,
          expenseTotalKopecks: 0,
          profitKopecks: 0,
          marginPercent: null,
        },
      });
    if (path === '/employees') return json({ employees: [] });
    if (path.includes('/kb/tree')) return json({ documents: [] });
    if (path.includes('/kb/search')) return json({ results: [] });
    if (path.includes('/search'))
      return json({ results: [], tasks: [], items: [] });
    if (path === '/auth/telegram/status') return json({ connected: false });
    if (path === '/integrations/github/status')
      return json({ connected: false });
    if (path.endsWith('/dispatcher-candidates'))
      return json({ candidates: [] });
    if (path.endsWith('/git-token-delegation'))
      return json({ mine: { enabled: false, hasGithubToken: false }, all: [] });
    if (method !== 'GET')
      writes.push({ path, method, body: req.postDataJSON() });
    if (path === '/projects/access-p0/tasks') {
      if (method === 'POST') {
        const task = {
          ...tasks[0],
          ...req.postDataJSON(),
          id: 'format-t' + tasks.length,
        };
        tasks.push(task);
        return json({ task }, 201);
      }
      return json({ tasks: controls.empty ? [] : tasks });
    }
    const movedTask = tasks.find(
      (t) => path === '/projects/access-p0/tasks/' + t.id + '/move',
    );
    if (movedTask && method === 'POST') {
      movedTask.status = req.postDataJSON().targetStatus;
      return json({ task: movedTask });
    }
    const task = tasks.find(
      (t) => path === '/projects/access-p0/tasks/' + t.id,
    );
    if (task) {
      if (method === 'PATCH') {
        if (globalThis.formattingFixture.delay)
          await new Promise((r) =>
            setTimeout(r, globalThis.formattingFixture.delay),
          );
        if (globalThis.formattingFixture.failSave)
          return json(
            { error: 'unavailable', message: 'Тестовая ошибка сохранения' },
            503,
          );
        Object.assign(task, req.postDataJSON());
      }
      return json({ task });
    }
    if (path.endsWith('/comments')) return json({ comments: [] });
    if (path.endsWith('/attachments')) return json({ attachments: [] });
    if (path.endsWith('/live/sessions')) return json({ sessions: [] });
    if (path.endsWith('/commits')) return json({ commits: [] });
    if (path.endsWith('/templates')) return json({ templates: [] });
    if (path === '/me/stats/completed-today') return json({ count: 0 });
    if (path === '/auth/me') return json({ user });
    if (path === '/agent/tokens') return json({ tokens: [] });
    if (path === '/me/shared-members')
      return json({ members: members.map((m) => ({ ...m, id: m.userId })) });
    if (path === '/auth/me/usage')
      return json({
        plan: 'prime',
        subscription: { startedAt: now, expiresAt: null },
        windows: {},
        isBlocked: false,
        blockedWindow: null,
        rubPerUsd: 90,
        primeTrialAvailable: false,
        isAdmin: false,
      });
    if (path === '/workspaces') return json({ workspaces: [workspace] });
    if (path === '/workspaces/access-ws' && method === 'PATCH') {
      Object.assign(workspace, req.postDataJSON());
      return json({ workspace });
    }
    if (path === '/workspaces/access-ws/members') return json({ members });
    if (path === '/workspaces/access-ws/projects') return json({ projects });
    if (path === '/workspaces/access-ws/project-access')
      return json({
        projects: projects.map(({ id, name, icon }) => ({ id, name, icon })),
        members: members.map((m) => ({
          userId: m.userId,
          hiddenProjectIds: hidden.get(m.userId),
        })),
      });
    if (path.startsWith('/workspaces/access-ws/project-access/')) {
      const parts = path.split('/');
      const p = parts[4],
        m = parts[5],
        visible = req.postDataJSON().visible;
      hidden.set(
        m,
        visible
          ? hidden.get(m).filter((id) => id !== p)
          : [...new Set([...hidden.get(m), p])],
      );
      return route.fulfill({ status: 204 });
    }
    if (path === '/workspaces/access-ws/invites') {
      if (method === 'POST') {
        const invite = {
          ...req.postDataJSON(),
          id: 'inv' + invites.length,
          workspaceId: workspace.id,
          expiresAt: now,
          acceptedAt: null,
          acceptedByUserId: null,
          createdByUserId: user.id,
          createdAt: now,
          url: 'https://example.test/invite/' + invites.length,
        };
        invites.push(invite);
        return json({ invite }, 201);
      }
      return json({ invites });
    }
    if (path === '/workspaces/access-ws/assignee-digest')
      return json({
        settings: {
          enabled: false,
          hour: 9,
          minute: 0,
          daysOfWeek: [1, 2, 3, 4, 5],
          telegramGroupChatId: null,
          telegramGroupTitle: null,
          recipientMode: 'all',
          recipientUserIds: [],
          projectMode: 'all',
          projectIds: [],
          commitSyncEnabled: false,
          commitSyncHour: 17,
          commitSyncMinute: 0,
          commitSyncAction: 'propose',
          eodReminderEnabled: false,
          eodReminderHour: 17,
          eodReminderMinute: 20,
        },
        members: [],
      });
    if (path.endsWith('/assignee-digest/groups')) return json({ groups: [] });
    if (path.endsWith('/commit-sync/projects')) return json({ projects: [] });
    if (path.endsWith('/kanban-columns')) return json({ columns: [] });
    if (path === '/projects') return json({ projects });
    const project = projects.find((p) => path.startsWith('/projects/' + p.id));
    if (project) {
      if (path === '/projects/' + project.id) return json({ project });
      if (path.endsWith('/members'))
        return json({
          members: members
            .filter((m) => !hidden.get(m.userId).includes(project.id))
            .map((m) => ({
              userId: m.userId,
              role: m.role,
              projectId: project.id,
              joinedAt: now,
              user: { ...m, id: m.userId, createdAt: now },
            })),
        });
      if (path.endsWith('/tasks')) return json({ tasks: [] });
      if (path.endsWith('/views'))
        return json({
          views: [
            {
              id: 'format-table',
              projectId: project.id,
              type: 'table',
              name: 'Таблица',
              sortOrder: 0,
              config: null,
              createdAt: now,
            },
            {
              id: 'format-list',
              projectId: project.id,
              type: 'list',
              name: 'Список',
              sortOrder: 1,
              config: null,
              createdAt: now,
            },
            {
              id: 'format-calendar',
              projectId: project.id,
              type: 'calendar',
              name: 'Календарь',
              sortOrder: 2,
              config: null,
              createdAt: now,
            },
          ],
        });
      if (path.endsWith('/commits')) return json({ commits: [] });
      if (path.endsWith('/templates')) return json({ templates: [] });
      if (path.endsWith('/properties'))
        return json({ properties: [], values: [] });
      if (path.endsWith('/activity'))
        return json({ items: [], nextCursor: null });
    }
    if (path === '/workspaces/chat/rooms') return json({ rooms: [] });
    if (path === '/me/kanban-colors') return json({ colors: {} });
    if (path === '/me/ui-prefs') return json({ prefs: {} });
    return json({});
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('http://127.0.0.1:5184/projects/access-p0');
  return { url: page.url() };
};
